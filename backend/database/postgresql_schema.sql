-- =============================================================================
-- TigerEx PostgreSQL Database Schema
-- Production-Ready Database Design for Cryptocurrency Exchange
-- =============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- =============================================================================
-- ENUM TYPES
-- =============================================================================

CREATE TYPE order_side AS ENUM ('buy', 'sell');
CREATE TYPE order_type AS ENUM ('market', 'limit', 'stop_loss', 'stop_limit', 'take_profit', 'trailing_stop', 'oco', 'iceberg', 'twap', 'post_only', 'fok', 'ioc');
CREATE TYPE order_status AS ENUM ('pending_new', 'new', 'partially_filled', 'filled', 'canceled', 'rejected', 'expired', 'pending_cancel', 'pending_modify');
CREATE TYPE time_in_force AS ENUM ('GTC', 'IOC', 'FOK', 'GTX', 'GTT');
CREATE TYPE position_mode AS ENUM ('isolated', 'cross', 'leverage');
CREATE TYPE kyc_level AS ENUM ('none', 'basic', 'intermediate', 'full', 'institution');
CREATE TYPE user_status AS ENUM ('pending', 'active', 'suspended', 'banned', 'closed');
CREATE TYPE wallet_type AS ENUM ('hot', 'cold', 'institutional', 'trading');
CREATE TYPE transaction_type AS ENUM ('deposit', 'withdrawal', 'transfer', 'trade', 'fee', 'reward', 'bonus', 'adjustment');
CREATE TYPE transaction_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled');
CREATE TYPE market_status AS ENUM ('pending', 'online', 'suspended', 'delisted');
CREATE TYPE verification_status AS ENUM ('pending', 'in_review', 'approved', 'rejected');

-- =============================================================================
-- USERS TABLE
-- =============================================================================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email CITEXT UNIQUE NOT NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    country VARCHAR(3) NOT NULL DEFAULT 'USA',
    kyc_level kyc_level NOT NULL DEFAULT 'none',
    status user_status NOT NULL DEFAULT 'pending',
    risk_level INTEGER NOT NULL DEFAULT 0,
    referral_code VARCHAR(20) UNIQUE,
    referred_by UUID REFERENCES users(id),
    deposit_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    withdrawal_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    trading_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    otp_secret VARCHAR(255),
    otp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    anti_phishing_code VARCHAR(20),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMP WITH TIME ZONE,
    last_login_ip INET,
    email_verified_at TIMESTAMP WITH TIME ZONE,
    phone_verified_at TIMESTAMP WITH TIME ZONE,
    banned_at TIMESTAMP WITH TIME ZONE,
    ban_reason TEXT
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_kyc_level ON users(kyc_level);
CREATE INDEX idx_users_referral_code ON users(referral_code);

-- =============================================================================
-- USER SESSIONS
-- =============================================================================

CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_token VARCHAR(255) UNIQUE NOT NULL,
    refresh_token VARCHAR(255),
    ip_address INET NOT NULL,
    user_agent TEXT,
    device_id VARCHAR(255),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_activity_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_sessions_token ON user_sessions(session_token);
CREATE INDEX idx_sessions_expires ON user_sessions(expires_at);

-- =============================================================================
-- USER API KEYS
-- =============================================================================

CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_hash VARCHAR(255) NOT NULL,
    secret_hash VARCHAR(255),
    name VARCHAR(100) NOT NULL,
    permissions TEXT[] NOT NULL,
    ip_whitelist INET[],
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    last_used_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash);

-- =============================================================================
-- KYC VERIFICATIONS
-- =============================================================================

CREATE TABLE kyc_verifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    level kyc_level NOT NULL,
    status verification_status NOT NULL DEFAULT 'pending',
    document_type VARCHAR(50),
    document_id VARCHAR(255),
    document_front_url TEXT,
    document_back_url TEXT,
    selfie_url TEXT,
    video_url TEXT,
    address_proof_url TEXT,
    rejection_reason TEXT,
    reviewed_by UUID,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    submitted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_kyc_user_id ON kyc_verifications(user_id);
CREATE INDEX idx_kyc_status ON kyc_verifications(status);

-- =============================================================================
-- WALLETS
-- =============================================================================

CREATE TABLE wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    currency VARCHAR(10) NOT NULL,
    wallet_type wallet_type NOT NULL DEFAULT 'trading',
    balance NUMERIC(30, 18) NOT NULL DEFAULT 0,
    locked_balance NUMERIC(30, 18) NOT NULL DEFAULT 0,
    available_balance NUMERIC(30, 18) GENERATED ALWAYS AS (balance - locked_balance) STORED,
    deposit_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    withdrawal_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, currency, wallet_type)
);

CREATE INDEX idx_wallets_user_id ON wallets(user_id);
CREATE INDEX idx_wallets_currency ON wallets(currency);
CREATE INDEX idx_wallets_user_currency ON wallets(user_id, currency);

-- =============================================================================
-- DEPOSIT ADDRESSES
-- =============================================================================

CREATE TABLE deposit_addresses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    address VARCHAR(255) NOT NULL,
    address_tag VARCHAR(255),
    network VARCHAR(50) NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(wallet_id, address, network)
);

CREATE INDEX idx_deposit_addresses_wallet ON deposit_addresses(wallet_id);
CREATE INDEX idx_deposit_addresses_address ON deposit_addresses(address);

-- =============================================================================
-- TRANSACTIONS
-- =============================================================================

CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    type transaction_type NOT NULL,
    status transaction_status NOT NULL DEFAULT 'pending',
    amount NUMERIC(30, 18) NOT NULL,
    fee NUMERIC(30, 18) NOT NULL DEFAULT 0,
    net_amount NUMERIC(30, 18) NOT NULL,
    currency VARCHAR(10) NOT NULL,
    tx_hash VARCHAR(255),
    address VARCHAR(255),
    address_tag VARCHAR(255),
    network VARCHAR(50),
    confirmations INTEGER NOT NULL DEFAULT 0,
    required_confirmations INTEGER NOT NULL DEFAULT 6,
    approved_by UUID,
    rejection_reason TEXT,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_transactions_wallet_id ON transactions(wallet_id);
CREATE INDEX idx_transactions_type ON transactions(type);
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transactions_tx_hash ON transactions(tx_hash);
CREATE INDEX idx_transactions_created_at ON transactions(created_at);

-- =============================================================================
-- MARKETS
-- =============================================================================

CREATE TABLE markets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(20) UNIQUE NOT NULL,
    base_currency VARCHAR(10) NOT NULL,
    quote_currency VARCHAR(10) NOT NULL,
    status market_status NOT NULL DEFAULT 'pending',
    price_precision INTEGER NOT NULL DEFAULT 8,
    quantity_precision INTEGER NOT NULL DEFAULT 8,
    min_price NUMERIC(30, 18),
    max_price NUMERIC(30, 18),
    tick_size NUMERIC(30, 18),
    min_quantity NUMERIC(30, 18),
    max_quantity NUMERIC(30, 18),
    min_notional NUMERIC(30, 18),
    maker_fee NUMERIC(10, 6) NOT NULL DEFAULT 0.001,
    taker_fee NUMERIC(10, 6) NOT NULL DEFAULT 0.001,
    listed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_markets_symbol ON markets(symbol);
CREATE INDEX idx_markets_status ON markets(status);
CREATE INDEX idx_markets_base_quote ON markets(base_currency, quote_currency);

-- =============================================================================
-- MARKET PRICES (for price feed)
-- =============================================================================

CREATE TABLE market_prices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    market_id UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    last_price NUMERIC(30, 18) NOT NULL,
    price_change_24h NUMERIC(30, 18) NOT NULL DEFAULT 0,
    price_change_percent_24h NUMERIC(10, 6) NOT NULL DEFAULT 0,
    high_24h NUMERIC(30, 18),
    low_24h NUMERIC(30, 18),
    volume_24h NUMERIC(30, 18) NOT NULL DEFAULT 0,
    quote_volume_24h NUMERIC(30, 18) NOT NULL DEFAULT 0,
    trades_24h INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_market_prices_market_id ON market_prices(market_id);

-- =============================================================================
-- ORDERS
-- =============================================================================

CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_uuid VARCHAR(36) UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    market_id UUID NOT NULL REFERENCES markets(id),
    side order_side NOT NULL,
    type order_type NOT NULL,
    time_in_force time_in_force NOT NULL DEFAULT 'GTC',
    price NUMERIC(30, 18),
    stop_price NUMERIC(30, 18),
    quantity NUMERIC(30, 18) NOT NULL,
    filled_quantity NUMERIC(30, 18) NOT NULL DEFAULT 0,
    remaining_quantity NUMERIC(30, 18) GENERATED ALWAYS AS (quantity - filled_quantity) STORED,
    avg_fill_price NUMERIC(30, 18),
    status order_status NOT NULL DEFAULT 'pending_new',
    client_order_id VARCHAR(100),
    iceberg_quantity NUMERIC(30, 18),
    filled_iceberg_quantity NUMERIC(30, 18) NOT NULL DEFAULT 0,
    trigger_price NUMERIC(30, 18),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    executed_at TIMESTAMP WITH TIME ZONE,
    canceled_at TIMESTAMP WITH TIME ZONE,
    canceled_by UUID,
    cancel_reason TEXT
);

CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_market_id ON orders(market_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_side ON orders(side);
CREATE INDEX idx_orders_type ON orders(type);
CREATE INDEX idx_orders_created_at ON orders(created_at);
CREATE INDEX idx_orders_order_uuid ON orders(order_uuid);
CREATE INDEX idx_orders_client_order_id ON orders(client_order_id);

-- =============================================================================
-- TRADES
-- =============================================================================

CREATE TABLE trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trade_uuid VARCHAR(36) UNIQUE NOT NULL,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    maker_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    taker_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    market_id UUID NOT NULL REFERENCES markets(id),
    maker_id UUID NOT NULL REFERENCES users(id),
    taker_id UUID NOT NULL REFERENCES users(id),
    side order_side NOT NULL,
    price NUMERIC(30, 18) NOT NULL,
    quantity NUMERIC(30, 18) NOT NULL,
    maker_fee NUMERIC(30, 18) NOT NULL,
    taker_fee NUMERIC(30, 18) NOT NULL,
    maker_commission NUMERIC(30, 18) NOT NULL DEFAULT 0,
    taker_commission NUMERIC(30, 18) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_trades_order_id ON trades(order_id);
CREATE INDEX idx_trades_maker_order_id ON trades(maker_order_id);
CREATE INDEX idx_trades_taker_order_id ON trades(taker_order_id);
CREATE INDEX idx_trades_market_id ON trades(market_id);
CREATE INDEX idx_trades_maker_id ON trades(maker_id);
CREATE INDEX idx_trades_taker_id ON trades(taker_id);
CREATE INDEX idx_trades_created_at ON trades(created_at);

-- =============================================================================
-- ORDER BOOK SNAPSHOTS
-- =============================================================================

CREATE TABLE order_book_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    market_id UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    bids JSONB NOT NULL,
    asks JSONB NOT NULL,
    sequence BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_order_book_snapshots_market_id ON order_book_snapshots(market_id);
CREATE INDEX idx_order_book_snapshots_sequence ON order_book_snapshots(market_id, sequence);
CREATE INDEX idx_order_book_snapshots_created_at ON order_book_snapshots(created_at);

-- =============================================================================
-- MARGIN ACCOUNTS
-- =============================================================================

CREATE TABLE margin_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    market_id UUID NOT NULL REFERENCES markets(id),
    position_mode position_mode NOT NULL DEFAULT 'cross',
    leverage INTEGER NOT NULL DEFAULT 1,
    margin_balance NUMERIC(30, 18) NOT NULL DEFAULT 0,
    reserved_margin NUMERIC(30, 18) NOT NULL DEFAULT 0,
    unrealized_pnl NUMERIC(30, 18) NOT NULL DEFAULT 0,
    realized_pnl NUMERIC(30, 18) NOT NULL DEFAULT 0,
    liquidation_price NUMERIC(30, 18),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, market_id)
);

CREATE INDEX idx_margin_accounts_user_id ON margin_accounts(user_id);
CREATE INDEX idx_margin_accounts_market_id ON margin_accounts(market_id);

-- =============================================================================
-- POSITIONS
-- =============================================================================

CREATE TABLE positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    market_id UUID NOT NULL REFERENCES markets(id),
    side order_side NOT NULL,
    quantity NUMERIC(30, 18) NOT NULL DEFAULT 0,
    entry_price NUMERIC(30, 18),
    mark_price NUMERIC(30, 18),
    leverage INTEGER NOT NULL DEFAULT 1,
    unrealized_pnl NUMERIC(30, 18) NOT NULL DEFAULT 0,
    realized_pnl NUMERIC(30, 18) NOT NULL DEFAULT 0,
    liquidation_price NUMERIC(30, 18),
    margin_used NUMERIC(30, 18) NOT NULL DEFAULT 0,
    take_profit_price NUMERIC(30, 18),
    stop_loss_price NUMERIC(30, 18),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(user_id, market_id, side)
);

CREATE INDEX idx_positions_user_id ON positions(user_id);
CREATE INDEX idx_positions_market_id ON positions(market_id);
CREATE INDEX idx_positions_status ON positions(quantity) WHERE quantity > 0;

-- =============================================================================
-- SUB ACCOUNTS
-- =============================================================================

CREATE TABLE sub_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    parent_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sub_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_name VARCHAR(100) NOT NULL,
    account_type VARCHAR(50) NOT NULL DEFAULT 'trading',
    permissions TEXT[] NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sub_accounts_parent ON sub_accounts(parent_user_id);
CREATE INDEX idx_sub_accounts_sub ON sub_accounts(sub_user_id);

-- =============================================================================
-- REFERRALS
-- =============================================================================

CREATE TABLE referrals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    referrer_id UUID NOT NULL REFERENCES users(id),
    referee_id UUID NOT NULL REFERENCES users(id),
    reward_amount NUMERIC(30, 18) NOT NULL DEFAULT 0,
    reward_currency VARCHAR(10) NOT NULL DEFAULT 'USDT',
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    paid_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(referee_id)
);

CREATE INDEX idx_referrals_referrer ON referrals(referrer_id);
CREATE INDEX idx_referrals_referee ON referrals(referee_id);

-- =============================================================================
-- FEE DISCOUNTS / VIP TIERS
-- =============================================================================

CREATE TABLE fee_tiers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tier_name VARCHAR(50) NOT NULL,
    tier_level INTEGER NOT NULL UNIQUE,
    maker_fee NUMERIC(10, 6) NOT NULL,
    taker_fee NUMERIC(10, 6) NOT NULL,
    min_volume_30d NUMERIC(30, 18) NOT NULL DEFAULT 0,
    min_holdings NUMERIC(30, 18) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE user_fee_tiers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tier_id UUID NOT NULL REFERENCES fee_tiers(id),
    effective_from TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_fee_tiers_user ON user_fee_tiers(user_id);

-- =============================================================================
-- STAKING
-- =============================================================================

CREATE TABLE staking_products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    currency VARCHAR(10) NOT NULL,
    product_name VARCHAR(100) NOT NULL,
    product_type VARCHAR(50) NOT NULL,
    apy NUMERIC(10, 6) NOT NULL,
    min_stake NUMERIC(30, 18) NOT NULL DEFAULT 0,
    max_stake NUMERIC(30, 18),
    lock_period_days INTEGER,
    early_unstaking_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    early_unstaking_penalty NUMERIC(10, 6),
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    start_date TIMESTAMP WITH TIME ZONE,
    end_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE staking_positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES staking_products(id),
    amount NUMERIC(30, 18) NOT NULL,
    claimed_rewards NUMERIC(30, 18) NOT NULL DEFAULT 0,
    start_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    unlock_date TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_staking_positions_user ON staking_positions(user_id);
CREATE INDEX idx_staking_positions_product ON staking_positions(product_id);

-- =============================================================================
-- SAVINGS / EARN PRODUCTS
-- =============================================================================

CREATE TABLE savings_products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    currency VARCHAR(10) NOT NULL,
    product_name VARCHAR(100) NOT NULL,
    product_type VARCHAR(50) NOT NULL,
    apy NUMERIC(10, 6) NOT NULL,
    min_amount NUMERIC(30, 18) NOT NULL DEFAULT 0,
    max_amount NUMERIC(30, 18),
    term_days INTEGER,
    auto_renew BOOLEAN NOT NULL DEFAULT TRUE,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE savings_positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES savings_products(id),
    amount NUMERIC(30, 18) NOT NULL,
    interest_earned NUMERIC(30, 18) NOT NULL DEFAULT 0,
    start_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    maturity_date TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- P2P TRADING
-- =============================================================================

CREATE TABLE p2p_advertisements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    side order_side NOT NULL,
    currency VARCHAR(10) NOT NULL,
    fiat_currency VARCHAR(10) NOT NULL,
    price_type VARCHAR(20) NOT NULL,
    price_offset NUMERIC(10, 6) NOT NULL,
    min_amount NUMERIC(30, 18) NOT NULL,
    max_amount NUMERIC(30, 18) NOT NULL,
    payment_methods TEXT[] NOT NULL,
    terms TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE p2p_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    advertisement_id UUID NOT NULL REFERENCES p2p_advertisements(id),
    maker_id UUID NOT NULL REFERENCES users(id),
    taker_id UUID NOT NULL REFERENCES users(id),
    side order_side NOT NULL,
    currency VARCHAR(10) NOT NULL,
    fiat_currency VARCHAR(10) NOT NULL,
    amount NUMERIC(30, 18) NOT NULL,
    price NUMERIC(30, 18) NOT NULL,
    total_amount NUMERIC(30, 18) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    maker_payment_method TEXT,
    taker_payment_method TEXT,
    maker_completed_at TIMESTAMP WITH TIME ZONE,
    taker_completed_at TIMESTAMP WITH TIME ZONE,
    cancel_reason TEXT,
    dispute_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_p2p_orders_maker ON p2p_orders(maker_id);
CREATE INDEX idx_p2p_orders_taker ON p2p_orders(taker_id);
CREATE INDEX idx_p2p_orders_status ON p2p_orders(status);

-- =============================================================================
-- NFT MARKETPLACE
-- =============================================================================

CREATE TABLE nft_collections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    collection_address VARCHAR(100) NOT NULL,
    name VARCHAR(100) NOT NULL,
    symbol VARCHAR(20) NOT NULL,
    description TEXT,
    creator_fee NUMERIC(10, 6) NOT NULL DEFAULT 0,
    royalty_fee NUMERIC(10, 6) NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE nfts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    collection_id UUID NOT NULL REFERENCES nft_collections(id),
    token_id VARCHAR(100) NOT NULL,
    owner_id UUID REFERENCES users(id),
    uri TEXT,
    metadata JSONB,
    price NUMERIC(30, 18),
    status VARCHAR(20) NOT NULL DEFAULT 'minted',
    listed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(collection_id, token_id)
);

CREATE TABLE nft_trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nft_id UUID NOT NULL REFERENCES nfts(id),
    seller_id UUID NOT NULL REFERENCES users(id),
    buyer_id UUID NOT NULL REFERENCES users(id),
    price NUMERIC(30, 18) NOT NULL,
    fee NUMERIC(30, 18) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- LAUNCHPAD
-- =============================================================================

CREATE TABLE launchpad_projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_name VARCHAR(100) NOT NULL,
    token_symbol VARCHAR(20) NOT NULL,
    token_address VARCHAR(100) NOT NULL,
    total_supply NUMERIC(30, 18) NOT NULL,
    allocation_for_sale NUMERIC(30, 18) NOT NULL,
    price_per_token NUMERIC(30, 18) NOT NULL,
    min_allocation NUMERIC(30, 18) NOT NULL,
    max_allocation NUMERIC(30, 18) NOT NULL,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'upcoming',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE launchpad_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES launchpad_projects(id),
    user_id UUID NOT NULL REFERENCES users(id),
    amount NUMERIC(30, 18) NOT NULL,
    tokens_allocated NUMERIC(30, 18) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(project_id, user_id)
);

-- =============================================================================
-- SECURITY / AUDIT LOGS
-- =============================================================================

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(100),
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

-- =============================================================================
-- RATE LIMITS
-- =============================================================================

CREATE TABLE rate_limits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    identifier VARCHAR(255) NOT NULL,
    identifier_type VARCHAR(50) NOT NULL,
    endpoint VARCHAR(100) NOT NULL,
    limit_count INTEGER NOT NULL,
    window_seconds INTEGER NOT NULL,
    current_count INTEGER NOT NULL DEFAULT 0,
    window_start TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(identifier, endpoint)
);

CREATE INDEX idx_rate_limits_identifier ON rate_limits(identifier);

-- =============================================================================
-- ADMIN USERS
-- =============================================================================

CREATE TABLE admin_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email CITEXT UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'admin',
    permissions TEXT[] NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- INSURANCE FUND
-- =============================================================================

CREATE TABLE insurance_fund (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    currency VARCHAR(10) NOT NULL DEFAULT 'USDT',
    balance NUMERIC(30, 18) NOT NULL DEFAULT 0,
    total_covered NUMERIC(30, 18) NOT NULL DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- TRADING FEES HISTORY
-- =============================================================================

CREATE TABLE trading_fees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    market_id UUID NOT NULL REFERENCES markets(id),
    fee NUMERIC(30, 18) NOT NULL,
    fee_currency VARCHAR(10) NOT NULL,
    volume NUMERIC(30, 18) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_trading_fees_user_id ON trading_fees(user_id);
CREATE INDEX idx_trading_fees_market_id ON trading_fees(market_id);
CREATE INDEX idx_trading_fees_created_at ON trading_fees(created_at);

-- =============================================================================
-- FUNCTIONS
-- =============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_wallets_updated_at BEFORE UPDATE ON wallets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_transactions_updated_at BEFORE UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to calculate available balance
CREATE OR REPLACE FUNCTION get_available_balance(p_user_id UUID, p_currency VARCHAR)
RETURNS NUMERIC AS $$
DECLARE
    v_balance NUMERIC(30, 18);
    v_locked NUMERIC(30, 18);
BEGIN
    SELECT COALESCE(wallet.balance, 0), COALESCE(wallet.locked_balance, 0)
    INTO v_balance, v_locked
    FROM wallets wallet
    WHERE wallet.user_id = p_user_id 
      AND wallet.currency = p_currency
      AND wallet.wallet_type = 'trading';

    RETURN COALESCE(v_balance, 0) - COALESCE(v_locked, 0);
END;
$$ LANGUAGE plpgsql;

-- Function to reserve funds for order
CREATE OR REPLACE FUNCTION reserve_order_funds(
    p_user_id UUID,
    p_currency VARCHAR,
    p_amount NUMERIC
) RETURNS BOOLEAN AS $$
DECLARE
    v_available NUMERIC(30, 18);
BEGIN
    v_available := get_available_balance(p_user_id, p_currency);
    
    IF v_available < p_amount THEN
        RETURN FALSE;
    END IF;

    UPDATE wallets 
    SET locked_balance = locked_balance + p_amount
    WHERE user_id = p_user_id AND currency = p_currency AND wallet_type = 'trading';

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Function to release locked funds
CREATE OR REPLACE FUNCTION release_locked_funds(
    p_user_id UUID,
    p_currency VARCHAR,
    p_amount NUMERIC
) RETURNS VOID AS $$
BEGIN
    UPDATE wallets 
    SET locked_balance = GREATEST(0, locked_balance - p_amount)
    WHERE user_id = p_user_id AND currency = p_currency AND wallet_type = 'trading';
END;
$$ LANGUAGE plpgsql;

-- Function to execute trade and update balances
CREATE OR REPLACE FUNCTION execute_trade(
    p_maker_id UUID,
    p_taker_id UUID,
    p_currency VARCHAR,
    p_maker_amount NUMERIC,
    p_taker_amount NUMERIC,
    p_maker_fee NUMERIC,
    p_taker_fee NUMERIC,
    p_order_id UUID
) RETURNS VOID AS $$
BEGIN
    -- Maker receives taker_amount minus fee
    UPDATE wallets 
    SET balance = balance + p_taker_amount - p_maker_fee,
        locked_balance = locked_balance - p_maker_amount
    WHERE user_id = p_maker_id AND currency = p_currency AND wallet_type = 'trading';

    -- Taker receives maker_amount minus fee
    UPDATE wallets 
    SET balance = balance + p_maker_amount - p_taker_fee,
        locked_balance = locked_balance - p_taker_amount
    WHERE user_id = p_taker_id AND currency = p_currency AND wallet_type = 'trading';

    -- Insert trading fees
    INSERT INTO trading_fees (user_id, market_id, fee, fee_currency, volume)
    VALUES 
        (p_maker_id, p_order_id, p_maker_fee, p_currency, p_maker_amount),
        (p_taker_id, p_order_id, p_taker_fee, p_currency, p_taker_amount);
END;
$$ LANGUAGE plpgsql;

-- Function to calculate order fees
CREATE OR REPLACE FUNCTION calculate_order_fee(
    p_amount NUMERIC,
    p_user_id UUID,
    p_market_id UUID
) RETURNS NUMERIC AS $$
DECLARE
    v_taker_fee NUMERIC(10, 6);
    v_tier_level INTEGER;
BEGIN
    -- Get user's fee tier
    SELECT ft.taker_fee INTO v_taker_fee
    FROM user_fee_tiers uft
    JOIN fee_tiers ft ON ft.id = uft.tier_id
    WHERE uft.user_id = p_user_id
      AND uft.effective_from <= NOW()
      AND (uft.expires_at IS NULL OR uft.expires_at > NOW())
    ORDER BY ft.tier_level DESC
    LIMIT 1;

    -- Default to standard taker fee if no tier
    IF v_taker_fee IS NULL THEN
        SELECT taker_fee INTO v_taker_fee
        FROM markets
        WHERE id = p_market_id;
    END IF;

    RETURN p_amount * COALESCE(v_taker_fee, 0.001);
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- SEEDS - INITIAL DATA
-- =============================================================================

-- Insert default fee tiers
INSERT INTO fee_tiers (tier_name, tier_level, maker_fee, taker_fee, min_volume_30d, min_holdings) VALUES
    ('VIP 0', 0, 0.001, 0.001, 0, 0),
    ('VIP 1', 1, 0.0008, 0.0008, 10000, 500),
    ('VIP 2', 2, 0.0006, 0.0006, 100000, 5000),
    ('VIP 3', 3, 0.0004, 0.0004, 500000, 25000),
    ('VIP 4', 4, 0.0002, 0.0002, 2000000, 100000),
    ('VIP 5', 5, 0, 0, 10000000, 500000);

-- Insert default markets
INSERT INTO markets (symbol, base_currency, quote_currency, status, price_precision, quantity_precision, min_price, max_price, tick_size, min_quantity, max_quantity, min_notional, maker_fee, taker_fee, listed_at) VALUES
    ('TGR/USDT', 'TGR', 'USDT', 'online', 8, 8, 0.0001, 1000000, 0.0001, 0.01, 1000000000, 1, 0.001, 0.001, NOW()),
    ('BTC/USDT', 'BTC', 'USDT', 'online', 2, 8, 0.01, 1000000, 0.01, 0.00001, 10000, 1, 0.001, 0.001, NOW()),
    ('ETH/USDT', 'ETH', 'USDT', 'online', 2, 8, 0.01, 1000000, 0.01, 0.0001, 1000000, 1, 0.001, 0.001, NOW()),
    ('BNB/USDT', 'BNB', 'USDT', 'online', 2, 8, 0.01, 100000, 0.01, 0.001, 1000000, 1, 0.001, 0.001, NOW()),
    ('USDC/USDT', 'USDC', 'USDT', 'online', 4, 8, 0.0001, 10000, 0.0001, 0.01, 1000000000, 1, 0.001, 0.001, NOW()),
    ('SOL/USDT', 'SOL', 'USDT', 'online', 4, 8, 0.001, 10000, 0.001, 0.01, 10000000, 1, 0.001, 0.001, NOW()),
    ('XRP/USDT', 'XRP', 'USDT', 'online', 5, 8, 0.0001, 1000, 0.0001, 1, 1000000000, 1, 0.001, 0.001, NOW()),
    ('ADA/USDT', 'ADA', 'USDT', 'online, 5, 8, 0.0001, 100, 0.0001, 1, 1000000000, 1, 0.001, 0.001, NOW());

-- Insert default insurance fund
INSERT INTO insurance_fund (currency, balance, total_covered) VALUES
    ('USDT', 1000000, 0);

-- =============================================================================
-- END OF SCHEMA
-- =============================================================================
