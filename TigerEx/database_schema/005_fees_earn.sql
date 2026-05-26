-- ============================================================================
-- TigerEx Database Schema - Fees, Earn & Products
-- Version: 1.0.0
-- Created: 2026-05-26
-- ============================================================================

-- Fee Schedule
CREATE TABLE IF NOT EXISTS fee_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_name VARCHAR(50) UNIQUE NOT NULL,
    schedule_type VARCHAR(20) NOT NULL CHECK (schedule_type IN ('spot', 'margin', 'futures', 'options', 'withdrawal', 'deposit', 'conversion', 'network')),
    maker_fee DECIMAL(8, 6) NOT NULL,
    taker_fee DECIMAL(8, 6) NOT NULL,
    fixed_fee DECIMAL(24, 8) DEFAULT 0,
    min_notional DECIMAL(24, 8) DEFAULT 0,
    fee_tiers JSONB,
    criteria JSONB,
    is_active BOOLEAN DEFAULT TRUE,
    priority INTEGER DEFAULT 0,
    valid_from TIMESTAMP WITH TIME ZONE,
    valid_until TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- User Fee Rates
CREATE TABLE IF NOT EXISTS user_fee_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    spot_maker_fee DECIMAL(8, 6),
    spot_taker_fee DECIMAL(8, 6),
    margin_maker_fee DECIMAL(8, 6),
    margin_taker_fee DECIMAL(8, 6),
    futures_maker_fee DECIMAL(8, 6),
    futures_taker_fee DECIMAL(8, 6),
    volume_30d DECIMAL(24, 2) DEFAULT 0,
    fees_30d DECIMAL(24, 8) DEFAULT 0,
    fee_level INTEGER DEFAULT 0,
    fee_exemptions JSONB DEFAULT '[]',
    applies_from TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Earn Products
CREATE TABLE IF NOT EXISTS earn_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id VARCHAR(50) UNIQUE NOT NULL,
    product_type VARCHAR(30) NOT NULL CHECK (product_type IN ('flexible', 'locked', 'staking', 'savings', 'launchpool', 'dual', 'structured', 'mining', ' lending')),
    asset_symbol VARCHAR(20) NOT NULL,
    reward_asset VARCHAR(20),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('pending', 'active', 'paused', 'ended')),
    min_stake DECIMAL(24, 8) NOT NULL,
    max_stake DECIMAL(24, 8),
    apy DECIMAL(8, 6),
    apy_range JSONB,
    lock_period INTERVAL,
    early_unpenalty_apr DECIMAL(8, 6),
    reward_frequency VARCHAR(20) DEFAULT 'daily',
    auto_compound BOOLEAN DEFAULT FALSE,
    can_renew BOOLEAN DEFAULT TRUE,
    capacity_used DECIMAL(24, 8) DEFAULT 0,
    capacity_max DECIMAL(24, 8),
    subscribers INTEGER DEFAULT 0,
    max_subscribers INTEGER,
    start_date TIMESTAMP WITH TIME ZONE,
    end_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_earn_products_product_type ON earn_products(product_type);
CREATE INDEX idx_earn_products_asset_symbol ON earn_products(asset_symbol);
CREATE INDEX idx_earn_products_status ON earn_products(status);

-- User Earn Positions
CREATE TABLE IF NOT EXISTS earn_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    position_id VARCHAR(50) UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id VARCHAR(50) NOT NULL REFERENCES earn_products(product_id),
    asset_symbol VARCHAR(20) NOT NULL,
    staked_amount DECIMAL(24, 8) NOT NULL,
    reward_amount DECIMAL(24, 8) DEFAULT 0,
    pending_rewards DECIMAL(24, 8) DEFAULT 0,
    accumulated_rewards DECIMAL(24, 8) DEFAULT 0,
    apy_at_stake DECIMAL(8, 6),
    period_start TIMESTAMP WITH TIME ZONE,
    period_end TIMESTAMP WITH TIME ZONE,
    next_claim_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('pending', 'active', 'claimed', 'unlocked', 'cancelled')),
    is_auto_renew BOOLEAN DEFAULT FALSE,
    claimed_rewards_total DECIMAL(24, 8) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, product_id)
);

CREATE INDEX idx_earn_positions_user_id ON earn_positions(user_id);
CREATE INDEX idx_earn_positions_product_id ON earn_positions(product_id);
CREATE INDEX idx_earn_positions_status ON earn_positions(status);

-- Staking Pool
CREATE TABLE IF NOT EXISTS staking_pools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pool_id VARCHAR(50) UNIQUE NOT NULL,
    asset_symbol VARCHAR(20) NOT NULL,
    blockchain VARCHAR(50),
    validator_address VARCHAR(255),
    validator_pubkey VARCHAR(255),
    total_staked DECIMAL(24, 8) DEFAULT 0,
    total_rewards DECIMAL(24, 8) DEFAULT 0,
    delegators INTEGER DEFAULT 0,
    apy DECIMAL(8, 6),
    min_stake DECIMAL(24, 8) DEFAULT 0,
    max_stake DECIMAL(24, 8),
    commission_rate DECIMAL(8, 6),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'slashed', 'offline')),
    slashed_count INTEGER DEFAULT 0,
    uptime_percentage DECIMAL(6, 4),
    score INTEGER DEFAULT 100,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Loans
CREATE TABLE IF NOT EXISTS loans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loan_id VARCHAR(50) UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    collateral_asset VARCHAR(20) NOT NULL,
    borrowed_asset VARCHAR(20) NOT NULL,
    collateral_amount DECIMAL(24, 8) NOT NULL,
    borrowed_amount DECIMAL(24, 8) NOT NULL,
    collateral_value DECIMAL(24, 8) NOT NULL,
    borrow_rate DECIMAL(8, 6) NOT NULL,
    liquidation_threshold DECIMAL(8, 6),
    health_factor NUMERIC(10, 4),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('pending', 'active', 'liquidated', 'repaid', 'defaulted')),
    liquidated_at TIMESTAMP WITH TIME ZONE,
    liquidation_bounty DECIMAL(24, 8),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_loans_user_id ON loans(user_id);
CREATE INDEX idx_loans_status ON loans(status);

-- Trigger for timestamps
CREATE TRIGGER update_fee_schedules_updated_at BEFORE UPDATE ON fee_schedules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_fee_rates_updated_at BEFORE UPDATE ON user_fee_rates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_earn_products_updated_at BEFORE UPDATE ON earn_products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_earn_positions_updated_at BEFORE UPDATE ON earn_positions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE fee_schedules IS 'Fee schedules by tier/volume';
COMMENT ON TABLE earn_products IS 'Savings/staking products';