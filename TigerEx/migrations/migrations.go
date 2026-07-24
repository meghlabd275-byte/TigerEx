// =============================================================================
// TIGEREX DATABASE MIGRATIONS
// Database migration management system
// Built with Go for high-load worldwide distributed systems
// =============================================================================

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// =============================================================================
// TYPES
// =============================================================================

// Migration represents a database migration
type Migration struct {
	Version   string    `json:"version"`
	Name      string    `json:"name"`
	Direction string    `json:"direction"` // up, down
	SQL       string    `json:"sql"`
	Checksum  string    `json:"checksum"`
	AppliedAt time.Time `json:"appliedAt"`
	Duration  int64     `json:"duration"` // milliseconds
}

// MigrationState represents migration state
type MigrationState struct {
	Version      string    `json:"version"`
	Name         string    `json:"name"`
	AppliedAt    time.Time `json:"appliedAt"`
	Duration     int64     `json:"duration"`
	RollbackAt   *time.Time `json:"rollbackAt,omitempty"`
	Checksum     string    `json:"checksum"`
}

// =============================================================================
// MIGRATION MANAGER
// =============================================================================

// MigrationManager handles database migrations
type MigrationManager struct {
	migrations  map[string]*Migration
	applied     map[string]*MigrationState
	migrationsDir string
}

// NewMigrationManager creates new migration manager
func NewMigrationManager(migrationsDir string) *MigrationManager {
	return &MigrationManager{
		migrations:    make(map[string]*Migration),
		applied:       make(map[string]*MigrationState),
		migrationsDir: migrationsDir,
	}
}

// AddMigration adds a migration
func (m *MigrationManager) AddMigration(version, name, sql string) {
	migration := &Migration{
		Version:  version,
		Name:     name,
		Direction: "up",
		SQL:      sql,
		Checksum: calculateChecksum(sql),
	}
	m.migrations[version] = migration
}

// =============================================================================
// MIGRATION TEMPLATES
// =============================================================================

// GetMigrations returns all migration templates
func GetMigrations() []*Migration {
	migrations := []*Migration{
		{
			Version: "001",
			Name:    "create_users_table",
			SQL: `CREATE TABLE IF NOT EXISTS users (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				email VARCHAR(255) UNIQUE NOT NULL,
				username VARCHAR(50) UNIQUE NOT NULL,
				password_hash VARCHAR(255) NOT NULL,
				kyc_level INT DEFAULT 0,
				kyc_status VARCHAR(20) DEFAULT 'PENDING',
				status VARCHAR(20) DEFAULT 'ACTIVE',
				email_verified BOOLEAN DEFAULT false,
				two_factor_enabled BOOLEAN DEFAULT false,
				country VARCHAR(2),
				referral_code VARCHAR(20),
				created_at TIMESTAMPTZ DEFAULT NOW(),
				updated_at TIMESTAMPTZ DEFAULT NOW(),
				last_login_at TIMESTAMPTZ
			);
			CREATE INDEX idx_users_email ON users(email);
			CREATE INDEX idx_users_kyc_status ON users(kyc_status);`,
		},
		{
			Version: "002",
			Name:    "create_wallets_table",
			SQL: `CREATE TABLE IF NOT EXISTS wallets (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				user_id UUID REFERENCES users(id) ON DELETE CASCADE,
				currency VARCHAR(20) NOT NULL,
				chain VARCHAR(30) NOT NULL,
				address VARCHAR(100) UNIQUE NOT NULL,
				balance DECIMAL(38,18) DEFAULT 0,
				available_balance DECIMAL(38,18) DEFAULT 0,
				locked_balance DECIMAL(38,18) DEFAULT 0,
				is_default BOOLEAN DEFAULT false,
				status VARCHAR(20) DEFAULT 'ACTIVE',
				created_at TIMESTAMPTZ DEFAULT NOW(),
				updated_at TIMESTAMPTZ DEFAULT NOW()
			);
			CREATE INDEX idx_wallets_user_id ON wallets(user_id);
			CREATE INDEX idx_wallets_address ON wallets(address);`,
		},
		{
			Version: "003",
			Name:    "create_orders_table",
			SQL: `CREATE TABLE IF NOT EXISTS orders (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				user_id UUID REFERENCES users(id) ON DELETE CASCADE,
				symbol VARCHAR(20) NOT NULL,
				side VARCHAR(10) NOT NULL,
				type VARCHAR(20) NOT NULL,
				quantity DECIMAL(38,8) NOT NULL,
				price DECIMAL(38,8),
				filled_quantity DECIMAL(38,8) DEFAULT 0,
				avg_fill_price DECIMAL(38,8),
				commission DECIMAL(38,18) DEFAULT 0,
				status VARCHAR(20) DEFAULT 'PENDING',
				time_in_force VARCHAR(10) DEFAULT 'GTC',
				created_at TIMESTAMPTZ DEFAULT NOW(),
				updated_at TIMESTAMPTZ DEFAULT NOW(),
				completed_at TIMESTAMPTZ
			);
			CREATE INDEX idx_orders_user_id ON orders(user_id);
			CREATE INDEX idx_orders_symbol ON orders(symbol);
			CREATE INDEX idx_orders_status ON orders(status);
			CREATE INDEX idx_orders_created_at ON orders(created_at);`,
		},
		{
			Version: "004",
			Name:    "create_transactions_table",
			SQL: `CREATE TABLE IF NOT EXISTS transactions (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				user_id UUID REFERENCES users(id) ON DELETE CASCADE,
				wallet_id UUID REFERENCES wallets(id) ON DELETE SET NULL,
				type VARCHAR(20) NOT NULL,
				currency VARCHAR(20) NOT NULL,
				amount DECIMAL(38,18) NOT NULL,
				fee DECIMAL(38,18) DEFAULT 0,
				status VARCHAR(20) DEFAULT 'PENDING',
				tx_hash VARCHAR(100),
				from_address VARCHAR(100),
				to_address VARCHAR(100),
				confirmations INT DEFAULT 0,
				required_confirmations INT DEFAULT 6,
				created_at TIMESTAMPTZ DEFAULT NOW(),
				updated_at TIMESTAMPTZ DEFAULT NOW(),
				completed_at TIMESTAMPTZ
			);
			CREATE INDEX idx_transactions_user_id ON transactions(user_id);
			CREATE INDEX idx_transactions_tx_hash ON transactions(tx_hash);
			CREATE INDEX idx_transactions_status ON transactions(status);`,
		},
		{
			Version: "005",
			Name:    "create_positions_table",
			SQL: `CREATE TABLE IF NOT EXISTS positions (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				user_id UUID REFERENCES users(id) ON DELETE CASCADE,
				symbol VARCHAR(20) NOT NULL,
				side VARCHAR(10) NOT NULL,
				quantity DECIMAL(38,8) NOT NULL,
				entry_price DECIMAL(38,8) NOT NULL,
				mark_price DECIMAL(38,8),
				leverage INT DEFAULT 1,
				margin DECIMAL(38,18) NOT NULL,
				unrealized_pnl DECIMAL(38,18) DEFAULT 0,
				realized_pnl DECIMAL(38,18) DEFAULT 0,
				liquidation_price DECIMAL(38,8),
				status VARCHAR(20) DEFAULT 'OPEN',
				created_at TIMESTAMPTZ DEFAULT NOW(),
				updated_at TIMESTAMPTZ DEFAULT NOW(),
				closed_at TIMESTAMPTZ
			);
			CREATE INDEX idx_positions_user_id ON positions(user_id);
			CREATE INDEX idx_positions_symbol ON positions(symbol);`,
		},
		{
			Version: "006",
			Name:    "create_fee_collections_table",
			SQL: `CREATE TABLE IF NOT EXISTS fee_collections (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				user_id UUID REFERENCES users(id) ON DELETE CASCADE,
				source VARCHAR(30) NOT NULL,
				type VARCHAR(30) NOT NULL,
				currency VARCHAR(20) NOT NULL,
				amount DECIMAL(38,18) NOT NULL,
				fee_amount DECIMAL(38,18) NOT NULL,
				volume DECIMAL(38,8),
				reference_id VARCHAR(100),
				created_at TIMESTAMPTZ DEFAULT NOW()
			);
			CREATE INDEX idx_fee_user ON fee_collections(user_id);
			CREATE INDEX idx_fee_source ON fee_collections(source);
			CREATE INDEX idx_fee_created ON fee_collections(created_at);`,
		},
		{
			Version: "007",
			Name:    "create_audit_logs_table",
			SQL: `CREATE TABLE IF NOT EXISTS audit_logs (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				user_id UUID REFERENCES users(id) ON DELETE SET NULL,
				action VARCHAR(50) NOT NULL,
				resource VARCHAR(50) NOT NULL,
				resource_id VARCHAR(100),
				details JSONB,
				ip_address INET,
				user_agent TEXT,
				status VARCHAR(20) DEFAULT 'SUCCESS',
				created_at TIMESTAMPTZ DEFAULT NOW()
			);
			CREATE INDEX idx_audit_user ON audit_logs(user_id);
			CREATE INDEX idx_audit_action ON audit_logs(action);
			CREATE INDEX idx_audit_created ON audit_logs(created_at);`,
		},
		{
			Version: "008",
			Name:    "create_kyc_records_table",
			SQL: `CREATE TABLE IF NOT EXISTS kyc_records (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
				level INT DEFAULT 0,
				status VARCHAR(20) DEFAULT 'PENDING',
				first_name VARCHAR(100),
				last_name VARCHAR(100),
				date_of_birth DATE,
				nationality VARCHAR(2),
				id_type VARCHAR(20),
				id_number VARCHAR(50),
				id_front_url TEXT,
				id_back_url TEXT,
				selfie_url TEXT,
				address_proof_url TEXT,
				aml_check_status VARCHAR(20) DEFAULT 'PENDING',
				risk_score FLOAT DEFAULT 0,
				rejection_reason TEXT,
				submitted_at TIMESTAMPTZ,
				reviewed_at TIMESTAMPTZ,
				created_at TIMESTAMPTZ DEFAULT NOW(),
				updated_at TIMESTAMPTZ DEFAULT NOW()
			);
			CREATE INDEX idx_kyc_user ON kyc_records(user_id);
			CREATE INDEX idx_kyc_status ON kyc_records(status);`,
		},
	}
	return migrations
}

// =============================================================================
// MAIN
// =============================================================================

func main() {
	fmt.Println("TigerEx Database Migrations")
	fmt.Println("=========================")
	
	manager := NewMigrationManager("./migrations")
	
	// Load migrations
	migrations := GetMigrations()
	fmt.Printf("\nTotal Migrations: %d\n", len(migrations))
	
	// Display migrations
	for _, m := range migrations {
		fmt.Printf("  %s: %s\n", m.Version, m.Name)
	}
	
	// Summary
	fmt.Println("\nMigration Summary:")
	fmt.Println("  - Users table")
	fmt.Println("  - Wallets table")
	fmt.Println("  - Orders table")
	fmt.Println("  - Transactions table")
	fmt.Println("  - Positions table")
	fmt.Println("  - Fee collections")
	fmt.Println("  - Audit logs")
	fmt.Println("  - KYC records")
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

func calculateChecksum(s string) string {
	hash := 0
	for _, c := range s {
		hash = hash*31 + int(c)
	}
	return fmt.Sprintf("%x", hash)
}

func generateMigrationFile(name string, sql string) string {
	return fmt.Sprintf(`-- Migration: %s
-- Created: %s

%s
`, name, time.Now().Format("2006-01-02 15:04:05"), sql)
}
