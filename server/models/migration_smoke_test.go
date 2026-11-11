package models

import (
	"context"
	"os"
	"testing"
)

func TestMigrationSmoke(t *testing.T) {
	if os.Getenv("DATABASE_URL") == "" {
		t.Skip("DATABASE_URL not set")
	}
	if err := InitDB(); err != nil {
		t.Fatalf("InitDB: %v", err)
	}
	defer CloseDB()

	ctx := context.Background()
	tables := []string{
		"users", "admins", "admin_sessions", "admin_audit_log",
		"futures_markets", "margin_markets", "support_messages", "support_tickets",
		"blockchains", "tokens", "fee_configs", "master_wallets",
		"p2p_ads", "p2p_trades", "earn_products", "earn_positions",
		"staking_pools", "staking_positions", "rewards", "launchpad_projects",
	}
	for _, tbl := range tables {
		var exists bool
		if err := Pool.QueryRow(ctx,
			"SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name=$1)", tbl).Scan(&exists); err != nil {
			t.Fatalf("query %s: %v", tbl, err)
		}
		if !exists {
			t.Errorf("table %s is missing after migration", tbl)
		}
	}

	cols := map[string]string{
		"admins":          "password_salt",
		"futures_markets": "initial_margin_rate",
		"margin_markets":  "collateral_ltv",
		"fee_configs":     "fee_percentage",
	}
	for tbl, col := range cols {
		var hasCol bool
		if err := Pool.QueryRow(ctx,
			"SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2)",
			tbl, col).Scan(&hasCol); err != nil {
			t.Fatalf("query col %s.%s: %v", tbl, col, err)
		}
		if !hasCol {
			t.Errorf("column %s.%s is missing after migration", tbl, col)
		}
	}
}
