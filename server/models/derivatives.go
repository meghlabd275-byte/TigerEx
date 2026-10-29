// Derivatives and margin market registry tables.
//
// These tables are the authoritative instrument registry for futures, perpetual
// and margin markets. Nothing is seeded here: an instrument only exists once an
// operator lists it through the admin listing API, so the public market
// endpoints can never serve a fabricated symbol.
package models

import "context"

func initDerivativesTables(ctx context.Context) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS futures_markets (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			symbol VARCHAR(50) UNIQUE NOT NULL,
			base_currency VARCHAR(20) NOT NULL,
			quote_currency VARCHAR(20) NOT NULL,
			settlement_currency VARCHAR(20) NOT NULL,
			contract_type VARCHAR(20) NOT NULL CHECK (contract_type IN ('perpetual', 'quarterly', 'delivery')),
			margin_type VARCHAR(20) NOT NULL CHECK (margin_type IN ('usdt_m', 'usdc_m', 'coin_m')),
			contract_size NUMERIC(32, 8) NOT NULL CHECK (contract_size > 0),
			price_precision INTEGER NOT NULL CHECK (price_precision BETWEEN 0 AND 18),
			quantity_precision INTEGER NOT NULL CHECK (quantity_precision BETWEEN 0 AND 18),
			min_quantity NUMERIC(32, 16) NOT NULL CHECK (min_quantity > 0),
			max_leverage INTEGER NOT NULL CHECK (max_leverage BETWEEN 1 AND 1001),
			initial_margin_rate NUMERIC(10, 8) NOT NULL CHECK (initial_margin_rate > 0 AND initial_margin_rate < 1),
			maintenance_margin_rate NUMERIC(10, 8) NOT NULL CHECK (maintenance_margin_rate > 0 AND maintenance_margin_rate < 1),
			liquidation_fee_rate NUMERIC(10, 8) NOT NULL CHECK (liquidation_fee_rate >= 0 AND liquidation_fee_rate < 1),
			maker_fee NUMERIC(10, 8) NOT NULL CHECK (maker_fee >= 0 AND maker_fee < 1),
			taker_fee NUMERIC(10, 8) NOT NULL CHECK (taker_fee >= 0 AND taker_fee < 1),
			funding_interval_hours INTEGER NOT NULL CHECK (funding_interval_hours BETWEEN 1 AND 24),
			funding_rate_cap NUMERIC(10, 8) NOT NULL CHECK (funding_rate_cap > 0 AND funding_rate_cap <= 1),
			oracle_source VARCHAR(80) NOT NULL,
			status VARCHAR(20) NOT NULL DEFAULT 'paused' CHECK (status IN ('active', 'paused', 'delisting')),
			created_by UUID REFERENCES admins(id) ON DELETE SET NULL,
			updated_by UUID REFERENCES admins(id) ON DELETE SET NULL,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			CHECK (maintenance_margin_rate < initial_margin_rate)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_futures_markets_status ON futures_markets(status)`,
		`CREATE INDEX IF NOT EXISTS idx_futures_markets_base_quote ON futures_markets(base_currency, quote_currency)`,

		`CREATE TABLE IF NOT EXISTS margin_markets (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			symbol VARCHAR(50) UNIQUE NOT NULL,
			base_currency VARCHAR(20) NOT NULL,
			quote_currency VARCHAR(20) NOT NULL,
			margin_mode VARCHAR(20) NOT NULL CHECK (margin_mode IN ('cross', 'isolated')),
			max_leverage INTEGER NOT NULL CHECK (max_leverage BETWEEN 1 AND 20),
			collateral_asset VARCHAR(20) NOT NULL,
			collateral_ltv NUMERIC(10, 8) NOT NULL CHECK (collateral_ltv > 0 AND collateral_ltv <= 1),
			liquidation_threshold NUMERIC(10, 8) NOT NULL CHECK (liquidation_threshold > 0 AND liquidation_threshold <= 1),
			liquidation_bonus NUMERIC(10, 8) NOT NULL CHECK (liquidation_bonus >= 0 AND liquidation_bonus < 1),
			borrowable_asset VARCHAR(20) NOT NULL,
			interest_base_apy NUMERIC(10, 8) NOT NULL CHECK (interest_base_apy >= 0),
			interest_kink_utilization NUMERIC(10, 8) NOT NULL CHECK (interest_kink_utilization > 0 AND interest_kink_utilization < 1),
			interest_jump_multiplier NUMERIC(10, 8) NOT NULL CHECK (interest_jump_multiplier >= 1),
			status VARCHAR(20) NOT NULL DEFAULT 'paused' CHECK (status IN ('active', 'paused', 'delisting')),
			created_by UUID REFERENCES admins(id) ON DELETE SET NULL,
			updated_by UUID REFERENCES admins(id) ON DELETE SET NULL,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			CHECK (collateral_ltv < liquidation_threshold)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_margin_markets_status ON margin_markets(status)`,
		`CREATE INDEX IF NOT EXISTS idx_margin_markets_base_quote ON margin_markets(base_currency, quote_currency)`,
	}

	for _, stmt := range statements {
		if _, err := Pool.Exec(ctx, stmt); err != nil {
			return err
		}
	}
	return nil
}
