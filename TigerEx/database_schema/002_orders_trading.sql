-- ============================================================================
-- TigerEx Database Schema - Orders & Trading
-- Version: 1.0.0
-- Created: 2026-05-26
-- ============================================================================

-- Markets/Symbols
CREATE TABLE IF NOT EXISTS markets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol VARCHAR(20) UNIQUE NOT NULL,
    base_asset VARCHAR(20) NOT NULL,
    quote_asset VARCHAR(20) NOT NULL,
    market_type VARCHAR(20) NOT NULL CHECK (market_type IN ('spot', 'margin', 'futures', 'options', 'perpetual')),
    status VARCHAR(20) DEFAULT 'trading' CHECK (status IN ('pre_launch', 'trading', 'suspended', 'halted', 'delisted')),
    precision_price DECIMAL(20, 10) NOT NULL DEFAULT 0.0000000100,
    precision_quantity DECIMAL(20, 10) NOT NULL DEFAULT 0.0000000001,
    min_quantity DECIMAL(20, 10) NOT NULL DEFAULT 0.00001,
    max_quantity DECIMAL(20, 10) NOT NULL DEFAULT 1000000000,
    min_notional DECIMAL(20, 8) NOT NULL DEFAULT 1.00,
    max_notional DECIMAL(20, 8) NOT NULL DEFAULT 100000000.00,
    tick_size DECIMAL(20, 10) NOT NULL DEFAULT 0.0000000100,
    lot_size DECIMAL(20, 10) NOT NULL DEFAULT 0.0000000001,
    max_leverage NUMERIC(10, 2) DEFAULT 1.00,
    liquidation_threshold NUMERIC(10, 4) DEFAULT 0.0050,
    maintenance_margin_rate NUMERIC(10, 4) DEFAULT 0.0050,
    initial_margin_rate NUMERIC(10, 4) DEFAULT 0.0100,
    maker_fee_rate NUMERIC(12, 8) DEFAULT 0.00100000,
    taker_fee_rate NUMERIC(12, 8) DEFAULT 0.00100000,
    allow_long BOOLEAN DEFAULT TRUE,
    allow_short BOOLEAN DEFAULT TRUE,
    allow_market_orders BOOLEAN DEFAULT TRUE,
    allow_limit_orders BOOLEAN DEFAULT TRUE,
    allow_stop_orders BOOLEAN DEFAULT TRUE,
    allow_oco_orders BOOLEAN DEFAULT TRUE,
    is_deliverable BOOLEAN DEFAULT FALSE,
    settlement_asset VARCHAR(20),
    settlement_period VARCHAR(20),
    contract_type VARCHAR(20),
    contract_size DECIMAL(20, 10) DEFAULT 1.0,
    expiry_date DATE,
    delivery_date DATE,
    underlying_symbol VARCHAR(20),
    index_source VARCHAR(50),
    index_price DECIMAL(20, 10),
    funding_rate DECIMAL(12, 8),
    next_funding_time TIMESTAMP WITH TIME ZONE,
    open_interest DECIMAL(20, 2) DEFAULT 0,
    volume_24h DECIMAL(20, 2) DEFAULT 0,
    turnover_24h DECIMAL(20, 2) DEFAULT 0,
    trades_24h BIGINT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_markets_symbol ON markets(symbol);
CREATE INDEX idx_markets_status ON markets(status);
CREATE INDEX idx_markets_market_type ON markets(market_type);

-- Assets
CREATE TABLE IF NOT EXISTS assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('crypto', 'fiat', 'stablecoin', 'security', 'token')),
    blockchain VARCHAR(50),
    contract_address VARCHAR(100),
    decimals SMALLINT NOT NULL DEFAULT 8,
    precision_price DECIMAL(20, 10) DEFAULT 0.0000000100,
    precision_quantity DECIMAL(20, 10) DEFAULT 0.0000000100,
    min_withdrawal DECIMAL(20, 10) NOT NULL DEFAULT 0.00001,
    max_withdrawal DECIMAL(20, 10) NOT NULL DEFAULT 1000000000,
    withdrawal_fee DECIMAL(20, 10) NOT NULL DEFAULT 0,
    deposit_enabled BOOLEAN DEFAULT TRUE,
    withdrawal_enabled BOOLEAN DEFAULT TRUE,
    deposit_confirmations SMALLINT DEFAULT 6,
    is_whitelisted BOOLEAN DEFAULT FALSE,
    is_stablecoin BOOLEAN DEFAULT FALSE,
    peg_currency VARCHAR(20),
    peg_ratio DECIMAL(14, 8) DEFAULT 1.00,
    collateral_weight NUMERIC(5, 2) DEFAULT 1.00,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'pending', 'suspended', 'delisted')),
    logo_url TEXT,
    website_url TEXT,
    explorer_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_assets_symbol ON assets(symbol);
CREATE INDEX idx_assets_type ON assets(type);
CREATE INDEX idx_assets_status ON assets(status);

-- Price feeds (for oracles)
CREATE TABLE IF NOT EXISTS price_feeds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_symbol VARCHAR(20) NOT NULL,
    source VARCHAR(50) NOT NULL,
    price DECIMAL(24, 8) NOT NULL,
    volume_24h DECIMAL(24, 2),
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(asset_symbol, source)
);

CREATE INDEX idx_price_feeds_symbol ON price_feeds(asset_symbol);
CREATE INDEX idx_price_feeds_timestamp ON price_feeds(timestamp DESC);

-- Orders
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id VARCHAR(50) UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    market_id UUID NOT NULL REFERENCES markets(id),
    side VARCHAR(10) NOT NULL CHECK (side IN ('buy', 'sell')),
    type VARCHAR(20) NOT NULL CHECK (type IN ('limit', 'market', 'stop_loss', 'stop_limit', 'take_profit', 'trailing_stop', 'oco', 'iceberg', 'fill_or_kill', 'immediate_or_cancel')),
    status VARCHAR(20) DEFAULT 'pending_new' CHECK (status IN ('pending_new', 'new', 'partially_filled', 'filled', 'canceled', 'rejected', 'expired', 'trade_report')),
    time_in_force VARCHAR(10) DEFAULT 'GTC' CHECK (time_in_force IN ('GTC', 'IOC', 'FOK', 'GTX', 'GTT')),
    price DECIMAL(24, 8),
    stop_price DECIMAL(24, 8),
    quantity DECIMAL(20, 10) NOT NULL,
    filled_quantity DECIMAL(20, 10) DEFAULT 0,
    remaining_quantity DECIMAL(20, 10) GENERATED ALWAYS AS (quantity - filled_quantity) STORED,
    avg_fill_price DECIMAL(24, 8),
    order_value DECIMAL(24, 8),
    fees DECIMAL(24, 8) DEFAULT 0,
    fee_asset VARCHAR(20),
    iceberg_quantity DECIMAL(20, 10),
    visible_quantity DECIMAL(20, 10),
    self_trade_prevention VARCHAR(20),
    post_only BOOLEAN DEFAULT FALSE,
    margin_used DECIMAL(24, 8) DEFAULT 0,
    realised_pnl DECIMAL(24, 8) DEFAULT 0,
    leverage NUMERIC(10, 2) DEFAULT 1.00,
    position_id UUID,
    client_order_id VARCHAR(100),
    order_url TEXT,
    expires_at TIMESTAMP WITH TIME ZONE,
    traded_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    canceled_at TIMESTAMP WITH TIME ZONE,
    rejected_at TIMESTAMP WITH TIME ZONE,
    rejected_reason TEXT
);

CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_order_id ON orders(order_id);
CREATE INDEX idx_orders_market_id ON orders(market_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_side ON orders(side);
CREATE INDEX idx_orders_type ON orders(type);
CREATE INDEX idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX idx_orders_traded_at ON orders(traded_at DESC);

-- Trades
CREATE TABLE IF NOT EXISTS trades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trade_id VARCHAR(50) UNIQUE NOT NULL,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    market_id UUID NOT NULL REFERENCES markets(id),
    maker_order_id UUID REFERENCES orders(id),
    taker_order_id UUID REFERENCES orders(id),
    user_id UUID NOT NULL REFERENCES users(id),
    maker_user_id UUID REFERENCES users(id),
    taker_user_id UUID REFERENCES users(id),
    side VARCHAR(10) NOT NULL CHECK (side IN ('buy', 'sell')),
    role VARCHAR(10) NOT NULL CHECK (role IN ('maker', 'taker')),
    price DECIMAL(24, 8) NOT NULL,
    quantity DECIMAL(20, 10) NOT NULL,
    quote_quantity DECIMAL(24, 8) NOT NULL,
    fee_to_maker DECIMAL(24, 8) DEFAULT 0,
    fee_to_taker DECIMAL(24, 8) DEFAULT 0,
    fee_asset_maker VARCHAR(20),
    fee_asset_taker VARCHAR(20),
    maker_fee_rate DECIMAL(14, 8),
    taker_fee_rate DECIMAL(14, 8),
    realized_pnl DECIMAL(24, 8) DEFAULT 0,
    position_realized_pnl DECIMAL(24, 8) DEFAULT 0,
    roi DECIMAL(12, 8),
    trade_type VARCHAR(20) DEFAULT 'exchange',
    is_self_trade BOOLEAN DEFAULT FALSE,
    order_type VARCHAR(20),
    client_order_id VARCHAR(100),
    maker_order_id_ref VARCHAR(50),
    taker_order_id_ref VARCHAR(50),
   -traded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_trades_order_id ON trades(order_id);
CREATE INDEX idx_trades_user_id ON trades(user_id);
CREATE INDEX idx_trades_market_id ON trades(market_id);
CREATE INDEX idx_trades_trade_id ON trades(trade_id);
CREATE INDEX idx_trades_traded_at ON trades(traded_at DESC);

-- Order book snapshots (for history)
CREATE TABLE IF NOT EXISTS order_book_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    market_id UUID NOT NULL REFERENCES markets(id),
    bids JSONB NOT NULL,
    asks JSONB NOT NULL,
    last_update_id BIGINT,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_order_book_snapshots_market_id ON order_book_snapshots(market_id);
CREATE INDEX idx_order_book_snapshots_timestamp ON order_book_snapshots(timestamp DESC);

-- Trigger for order timestamps
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Functions for order management
CREATE OR REPLACE FUNCTION calculate_order_value(
    p_price DECIMAL, 
    p_quantity DECIMAL
) RETURNS DECIMAL(24, 8) AS $$
BEGIN
    RETURN COALESCE(p_price, 0) * COALESCE(p_quantity, 0);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION update_order_filled_amount()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.filled_quantity != OLD.filled_quantity THEN
        NEW.updated_at := CURRENT_TIMESTAMP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_order_filled
    BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_order_filled_amount();

COMMENT ON TABLE markets IS 'Trading pairs/markets';
COMMENT ON TABLE assets IS 'Supported assets (crypto/fiat)';
COMMENT ON TABLE orders IS 'Customer orders';
COMMENT ON TABLE trades IS 'Executed trades';