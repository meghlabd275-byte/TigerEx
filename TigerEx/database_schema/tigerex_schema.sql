-- TigerEx Complete Database Schema
-- PostgreSQL 14+

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- CORE USER MANAGEMENT
-- ============================================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(50) UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    two_factor_secret VARCHAR(255),
    two_factor_enabled BOOLEAN DEFAULT FALSE,
    kyc_level INTEGER DEFAULT 0 CHECK (kyc_level BETWEEN 0 AND 3),
    kyc_status VARCHAR(50) DEFAULT 'pending' CHECK (kyc_status IN ('pending', 'submitted', 'processing', 'approved', 'rejected')),
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'locked', 'closed')),
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

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_kyc ON users(kyc_status);

CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    refresh_token_hash VARCHAR(255),
    ip_address VARCHAR(45),
    user_agent TEXT,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_sessions_token ON user_sessions(token_hash);

CREATE TABLE api_keys (
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

CREATE INDEX idx_api_keys_user ON api_keys(user_id);
CREATE INDEX idx_api_keys_keyid ON api_keys(key_id);

CREATE TABLE user_settings (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    notification_email BOOLEAN DEFAULT TRUE,
    notification_sms BOOLEAN DEFAULT FALSE,
    notification_push BOOLEAN DEFAULT TRUE,
    theme VARCHAR(20) DEFAULT 'dark',
    default_currency VARCHAR(10) DEFAULT 'USD',
    fee_tier VARCHAR(20) DEFAULT 'standard',
    preference_json JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- WALLET AND BALANCES
-- ============================================

CREATE TABLE wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    currency VARCHAR(20) NOT NULL,
    wallet_type VARCHAR(20) DEFAULT 'spot' CHECK (wallet_type IN ('spot', 'margin', 'futures', 'funding', 'cold')),
    balance DECIMAL(30, 18) DEFAULT 0,
    available_balance DECIMAL(30, 18) DEFAULT 0,
    locked_balance DECIMAL(30, 18) DEFAULT 0,
    pending_deposit DECIMAL(30, 18) DEFAULT 0,
    pending_withdrawal DECIMAL(30, 18) DEFAULT 0,
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, currency, wallet_type)
);

CREATE INDEX idx_wallets_user ON wallets(user_id);
CREATE INDEX idx_wallets_currency ON wallets(currency);

CREATE TABLE deposit_addresses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    currency VARCHAR(20) NOT NULL,
    network VARCHAR(30) NOT NULL,
    address VARCHAR(500) NOT NULL,
    address_tag VARCHAR(500),
    is_primary BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_deposit_addr_user ON deposit_addresses(user_id);
CREATE INDEX idx_deposit_addr_currency ON deposit_addresses(currency);

CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(30) NOT NULL CHECK (type IN ('deposit', 'withdrawal', 'transfer', 'trade', 'fee', 'bonus', 'refund')),
    currency VARCHAR(20) NOT NULL,
    amount DECIMAL(30, 18) NOT NULL,
    fee DECIMAL(30, 18) DEFAULT 0,
    status VARCHAR(30) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
    tx_hash VARCHAR(255),
    from_address VARCHAR(500),
    to_address VARCHAR(500),
    network VARCHAR(30),
    confirmations INTEGER DEFAULT 0,
    required_confirmations INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_trans_user ON transactions(user_id);
CREATE INDEX idx_trans_type ON transactions(type);
CREATE INDEX idx_trans_status ON transactions(status);
CREATE INDEX idx_trans_created ON transactions(created_at DESC);
CREATE INDEX idx_trans_hash ON transactions(tx_hash);

-- ============================================
-- MARKETS AND TRADING
-- ============================================

CREATE TABLE markets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(20) UNIQUE NOT NULL,
    base_currency VARCHAR(20) NOT NULL,
    quote_currency VARCHAR(20) NOT NULL,
    status VARCHAR(20) DEFAULT 'trading' CHECK (status IN ('trading', 'halted', 'auction', 'maintenance')),
    base_precision INTEGER DEFAULT 8,
    quote_precision INTEGER DEFAULT 8,
    min_price DECIMAL(30, 18),
    max_price DECIMAL(30, 18),
    tick_size DECIMAL(30, 18),
    min_quantity DECIMAL(30, 18),
    min_notional DECIMAL(30, 18),
    max_quantity DECIMAL(30, 18),
    maker_fee DECIMAL(10, 8) DEFAULT 0.001,
    taker_fee DECIMAL(10, 8) DEFAULT 0.001,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_markets_symbol ON markets(symbol);
CREATE INDEX idx_markets_status ON markets(status);

CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_order_id VARCHAR(100),
    symbol VARCHAR(20) NOT NULL,
    side VARCHAR(10) NOT NULL CHECK (side IN ('buy', 'sell')),
    order_type VARCHAR(20) NOT NULL CHECK (order_type IN ('market', 'limit', 'stop_loss', 'stop_limit', 'take_profit', 'take_profit_limit', 'iceberg', 'trailing_stop')),
    price DECIMAL(30, 18),
    stop_price DECIMAL(30, 18),
    quantity DECIMAL(30, 18) NOT NULL,
    filled_quantity DECIMAL(30, 18) DEFAULT 0,
    avg_fill_price DECIMAL(30, 18),
    remaining_quantity DECIMAL(30, 18),
    time_in_force VARCHAR(10) DEFAULT 'GTC' CHECK (time_in_force IN ('GTC', 'IOC', 'FOK', 'GTX')),
    status VARCHAR(20) DEFAULT 'new' CHECK (status IN ('new', 'partially_filled', 'filled', 'cancelled', 'rejected', 'expired')),
    is_liquidation BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    filled_at TIMESTAMP
);

CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_orders_symbol ON orders(symbol);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created ON orders(created_at DESC);
CREATE INDEX idx_orders_client ON orders(client_order_id);

CREATE TABLE order_history (
    LIKE orders INCLUDING ALL
);

CREATE TABLE trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id),
    match_order_id UUID NOT NULL,
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
    maker_fee_currency VARCHAR(20),
    taker_fee_currency VARCHAR(20),
    is_maker BOOLEAN,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_trades_order ON trades(order_id);
CREATE INDEX idx_trades_symbol ON trades(symbol);
CREATE INDEX idx_trades_maker ON trades(maker_user_id);
CREATE INDEX idx_trades_taker ON trades(taker_user_id);
CREATE INDEX idx_trades_created ON trades(created_at DESC);

CREATE TABLE order_book_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(20) NOT NULL,
    bids JSONB NOT NULL,
    asks JSONB NOT NULL,
    timestamp TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_obs_symbol ON order_book_snapshots(symbol);
CREATE INDEX idx_obs_timestamp ON order_book_snapshots(timestamp DESC);

-- ============================================
-- MARGIN AND FUTURES
-- ============================================

CREATE TABLE margin_positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    symbol VARCHAR(20) NOT NULL,
    position_side VARCHAR(10) CHECK (position_side IN ('long', 'short')),
    quantity DECIMAL(30, 18) DEFAULT 0,
    entry_price DECIMAL(30, 18),
    mark_price DECIMAL(30, 18),
    liquidation_price DECIMAL(30, 18),
    leverage INTEGER DEFAULT 1,
    isolated_margin DECIMAL(30, 18) DEFAULT 0,
    unrealized_pnl DECIMAL(30, 18) DEFAULT 0,
    realized_pnl DECIMAL(30, 18) DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_margin_user ON margin_positions(user_id);
CREATE INDEX idx_margin_symbol ON margin_positions(symbol);

CREATE TABLE futures_positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    symbol VARCHAR(20) NOT NULL,
    position_side VARCHAR(10),
    quantity DECIMAL(30, 18) DEFAULT 0,
    entry_price DECIMAL(30, 18),
    mark_price DECIMAL(30, 18),
    liquidation_price DECIMAL(30, 18),
    leverage INTEGER DEFAULT 1,
    isolated_margin DECIMAL(30, 18) DEFAULT 0,
    cross_margin DECIMAL(30, 18) DEFAULT 0,
    unrealized_pnl DECIMAL(30, 18) DEFAULT 0,
    realized_pnl DECIMAL(30, 18) DEFAULT 0,
    funding_fee DECIMAL(30, 18) DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_futures_user ON futures_positions(user_id);
CREATE INDEX idx_futures_symbol ON futures_positions(symbol);

CREATE TABLE funding_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    symbol VARCHAR(20) NOT NULL,
    position_id UUID,
    amount DECIMAL(30, 18),
    rate DECIMAL(15, 12),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_funding_user ON funding_payments(user_id);
CREATE INDEX idx_funding_symbol ON funding_payments(symbol);

-- ============================================
-- KYC AND COMPLIANCE
-- ============================================

CREATE TABLE kyc_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    document_type VARCHAR(50) NOT NULL CHECK (document_type IN ('passport', 'national_id', 'drivers_license', 'proof_of_address', 'selfie', 'video')),
    document_number VARCHAR(100),
    issuing_country VARCHAR(10),
    file_urls JSONB DEFAULT '[]',
    extracted_data JSONB DEFAULT '{}',
    verification_status VARCHAR(30) DEFAULT 'pending' CHECK (verification_status IN ('pending', 'submitted', 'verified', 'rejected', 'expired')),
    rejection_reason TEXT,
    verified_at TIMESTAMP,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_kyc_user ON kyc_documents(user_id);
CREATE INDEX idx_kyc_status ON kyc_documents(verification_status);

CREATE TABLE kyc_audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    action VARCHAR(50) NOT NULL,
    performed_by UUID,
    ip_address VARCHAR(45),
    old_data JSONB,
    new_data JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_kyc_audit_user ON kyc_audit_log(user_id);

CREATE TABLE aml_checks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    check_type VARCHAR(50) NOT NULL,
    status VARCHAR(30) DEFAULT 'pending',
    result_data JSONB,
    risk_score INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_aml_user ON aml_checks(user_id);

-- ============================================
-- PAYMENTS AND FIAT
-- ============================================

CREATE TABLE fiat_deposits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    amount DECIMAL(30, 18) NOT NULL,
    currency VARCHAR(10) NOT NULL,
    method VARCHAR(50) NOT NULL,
    status VARCHAR(30) DEFAULT 'pending',
    bank_reference VARCHAR(255),
    fees DECIMAL(30, 18) DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_fiat_dep_user ON fiat_deposits(user_id);
CREATE INDEX idx_fiat_dep_status ON fiat_deposits(status);

CREATE TABLE fiat_withdrawals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    amount DECIMAL(30, 18) NOT NULL,
    currency VARCHAR(10) NOT NULL,
    method VARCHAR(50) NOT NULL,
    bank_account_id UUID,
    status VARCHAR(30) DEFAULT 'pending',
    fees DECIMAL(30, 18) DEFAULT 0,
    reference VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_fiat_wd_user ON fiat_withdrawals(user_id);
CREATE INDEX idx_fiat_wd_status ON fiat_withdrawals(status);

CREATE TABLE bank_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    bank_name VARCHAR(100),
    account_number_encrypted TEXT,
    account_holder_name VARCHAR(200),
    iban VARCHAR(50),
    swift_code VARCHAR(20),
    is_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_bank_user ON bank_accounts(user_id);

-- ============================================
-- P2P TRADING
-- ============================================

CREATE TABLE p2p_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    maker_id UUID NOT NULL REFERENCES users(id),
    side VARCHAR(10) CHECK (side IN ('buy', 'sell')),
    fiat_currency VARCHAR(10) NOT NULL,
    price DECIMAL(30, 18) NOT NULL,
    quantity DECIMAL(30, 18) NOT NULL,
    fulfilled_quantity DECIMAL(30, 18) DEFAULT 0,
    payment_method VARCHAR(50),
    status VARCHAR(30) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_p2p_maker ON p2p_orders(maker_id);
CREATE INDEX idx_p2p_status ON p2p_orders(status);

CREATE TABLE p2p_trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    p2p_order_id UUID NOT NULL REFERENCES p2p_orders,
    buyer_id UUID NOT NULL REFERENCES users(id),
    seller_id UUID NOT NULL REFERENCES users(id),
    amount DECIMAL(30, 18) NOT NULL,
    fiat_amount DECIMAL(30, 18) NOT NULL,
    status VARCHAR(30) DEFAULT 'pending',
    payment_proof_url TEXT,
    released_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_p2p_trade_buyer ON p2p_trades(buyer_id);
CREATE INDEX idx_p2p_trade_seller ON p2p_trades(seller_id);

-- ============================================
-- COPY TRADING
-- ============================================

CREATE TABLE copy_trading_followers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    follower_id UUID NOT NULL REFERENCES users(id),
    trader_id UUID NOT NULL REFERENCES users(id),
    allocated_amount DECIMAL(30, 18) NOT NULL,
    current_profit DECIMAL(30, 18) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'active',
    stop_loss_percent DECIMAL(10, 8),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_copy_follower ON copy_trading_followers(follower_id);
CREATE INDEX idx_copy_trader ON copy_trading_followers(trader_id);

-- ============================================
-- STAKING AND EARN
-- ============================================

CREATE TABLE staking_products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    currency VARCHAR(20) NOT NULL,
    duration_days INTEGER NOT NULL,
    annual_rate DECIMAL(10, 8) NOT NULL,
    min_amount DECIMAL(30, 18),
    max_amount DECIMAL(30, 18),
    total_staked DECIMAL(30, 18) DEFAULT 0,
    max_stake DECIMAL(30, 18),
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE staking_positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    product_id UUID NOT NULL REFERENCES staking_products(id),
    amount DECIMAL(30, 18) NOT NULL,
    reward DECIMAL(30, 18) DEFAULT 0,
    start_date TIMESTAMP NOT NULL,
    end_date TIMESTAMP NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_stake_user ON staking_positions(user_id);
CREATE INDEX idx_stake_product ON staking_positions(product_id);

-- ============================================
-- REFERRALS AND REWARDS
-- ============================================

CREATE TABLE referrals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    referrer_id UUID NOT NULL REFERENCES users(id),
    referred_id UUID NOT NULL REFERENCES users(id),
    bonus_amount DECIMAL(30, 18),
    bonus_paid BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_referrals_referrer ON referrals(referrer_id);

CREATE TABLE reward_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    type VARCHAR(50) NOT NULL,
    amount DECIMAL(30, 18) NOT NULL,
    currency VARCHAR(20),
    reference_id UUID,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- ADMIN AND OPERATIONS
-- ============================================

CREATE TABLE admin_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL,
    permissions JSONB DEFAULT '[]',
    last_login_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE admin_audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_id UUID REFERENCES admin_users(id),
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(50),
    target_id UUID,
    details JSONB,
    ip_address VARCHAR(45),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_admin_audit_time ON admin_audit_log(created_at DESC);

CREATE TABLE system_settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE trading_fees (
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

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT,
    data JSONB DEFAULT '{}',
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_notif_user ON notifications(user_id);
CREATE INDEX idx_notif_read ON notifications(is_read);

CREATE TABLE email_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    to_address VARCHAR(255) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    body TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    attempts INTEGER DEFAULT 0,
    sent_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_email_queue_status ON email_queue(status);

-- ============================================
-- RATE LIMITING
-- ============================================

CREATE TABLE rate_limits (
    key VARCHAR(100) PRIMARY KEY,
    hits INTEGER DEFAULT 0,
    window_start TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP
);

-- ============================================
-- TRIGGER FOR UPDATED_AT
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
CREATE TRIGGER margin_updated_at BEFORE UPDATE ON margin_positions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER futures_updated_at BEFORE UPDATE ON futures_positions FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- SEED DATA
-- ============================================

INSERT INTO markets (symbol, base_currency, quote_currency, base_precision, quote_precision, tick_size, min_quantity, min_notional, maker_fee, taker_fee) VALUES
('BTCUSDT', 'BTC', 'USDT', 8, 8, '0.01', '0.00001', '10', 0.001, 0.001),
('ETHUSDT', 'ETH', 'USDT', 8, 8, '0.01', '0.0001', '10', 0.001, 0.001),
('BNBUSDT', 'BNB', 'USDT', 8, 8, '0.01', '0.001', '10', 0.001, 0.001),
('SOLUSDT', 'SOL', 'USDT', 8, 8, '0.001', '0.01', '10', 0.001, 0.001),
('XRPUSDT', 'XRP', 'USDT', 8, 8, '0.0001', '1', '10', 0.001, 0.001);

INSERT INTO trading_fees (tier_name, maker_fee, taker_fee, min_volume_30d) VALUES
('standard', 0.001, 0.001, 0),
('vip1', 0.0008, 0.001, 100000),
('vip2', 0.0006, 0.0008, 1000000),
('vip3', 0.0004, 0.0006, 10000000);