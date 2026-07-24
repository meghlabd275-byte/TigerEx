// =============================================================================
// TIGEREX DATABASE SCHEMA
// PostgreSQL database schema for TigerEx exchange
// Built with Go for high-load worldwide distributed systems
// =============================================================================

package main

import (
	"fmt"
	"strings"
	"time"
)

// =============================================================================
// SCHEMA DEFINITIONS
// =============================================================================

// Table represents a database table
type Table struct {
	Name    string
	Columns []Column
	Indexes []Index
	ForeignKeys []ForeignKey
}

// Column represents a table column
type Column struct {
	Name        string
	Type        string
	Nullable    bool
	Default     string
	Description string
}

// Index represents a database index
type Index struct {
	Name    string
	Columns []string
	Unique  bool
	Type   string // BTREE, HASH, GIN, etc.
}

// ForeignKey represents a foreign key constraint
type ForeignKey struct {
	Name       string
	Columns    []string
	Referenced TableReference
}

// TableReference represents a referenced table
type TableReference struct {
	Table   string
	Columns []string
	OnDelete string
	OnUpdate string
}

// =============================================================================
// SCHEMA TABLES
// =============================================================================

// GetUsersTable returns users table schema
func GetUsersTable() Table {
	return Table{
		Name: "users",
		Columns: []Column{
			{Name: "id", Type: "UUID", Nullable: false, Default: "gen_random_uuid()", Description: "Primary key"},
			{Name: "email", Type: "VARCHAR(255)", Nullable: false, Description: "User email"},
			{Name: "username", Type: "VARCHAR(50)", Nullable: false, Description: "Username"},
			{Name: "password_hash", Type: "VARCHAR(255)", Nullable: false, Description: "Bcrypt hash"},
			{Name: "kyc_level", Type: "INT", Nullable: false, Default: "0", Description: "KYC level 0-3"},
			{Name: "kyc_status", Type: "VARCHAR(20)", Nullable: false, Default: "'PENDING'", Description: "KYC status"},
			{Name: "status", Type: "VARCHAR(20)", Nullable: false, Default: "'ACTIVE'", Description: "Account status"},
			{Name: "email_verified", Type: "BOOLEAN", Nullable: false, Default: "false"},
			{Name: "phone_verified", Type: "BOOLEAN", Nullable: false, Default: "false"},
			{Name: "two_factor_enabled", Type: "BOOLEAN", Nullable: false, Default: "false"},
			{Name: "country", Type: "VARCHAR(2)", Nullable: true, Description: "Country code"},
			{Name: "referral_code", Type: "VARCHAR(20)", Nullable: true},
			{Name: "referred_by", Type: "UUID", Nullable: true},
			{Name: "created_at", Type: "TIMESTAMPTZ", Nullable: false, Default: "NOW()"},
			{Name: "updated_at", Type: "TIMESTAMPTZ", Nullable: false, Default: "NOW()"},
			{Name: "last_login_at", Type: "TIMESTAMPTZ", Nullable: true},
		},
		Indexes: []Index{
			{Name: "idx_users_email", Columns: []string{"email"}, Unique: true},
			{Name: "idx_users_username", Columns: []string{"username"}, Unique: true},
			{Name: "idx_users_referral_code", Columns: []string{"referral_code"}, Unique: true},
			{Name: "idx_users_kyc_status", Columns: []string{"kyc_status"}},
			{Name: "idx_users_created_at", Columns: []string{"created_at"}},
		},
		ForeignKeys: []ForeignKey{
			{Name: "fk_users_referred_by", Columns: []string{"referred_by"}, Referenced: TableReference{Table: "users", Columns: []string{"id"}, OnDelete: "SET NULL"}},
		},
	}
}

// GetWalletsTable returns wallets table schema
func GetWalletsTable() Table {
	return Table{
		Name: "wallets",
		Columns: []Column{
			{Name: "id", Type: "UUID", Nullable: false, Default: "gen_random_uuid()"},
			{Name: "user_id", Type: "UUID", Nullable: false},
			{Name: "currency", Type: "VARCHAR(20)", Nullable: false, Description: "BTC, ETH, USDT, etc."},
			{Name: "chain", Type: "VARCHAR(30)", Nullable: false, Description: "Blockchain network"},
			{Name: "address", Type: "VARCHAR(100)", Nullable: false, Description: "Wallet address"},
			{Name: "private_key_encrypted", Type: "TEXT", Nullable: true, Description: "Encrypted private key"},
			{Name: "balance", Type: "DECIMAL(38,18)", Nullable: false, Default: "0"},
			{Name: "available_balance", Type: "DECIMAL(38,18)", Nullable: false, Default: "0"},
			{Name: "locked_balance", Type: "DECIMAL(38,18)", Nullable: false, Default: "0"},
			{Name: "is_default", Type: "BOOLEAN", Nullable: false, Default: "false"},
			{Name: "status", Type: "VARCHAR(20)", Nullable: false, Default: "'ACTIVE'"},
			{Name: "created_at", Type: "TIMESTAMPTZ", Nullable: false, Default: "NOW()"},
			{Name: "updated_at", Type: "TIMESTAMPTZ", Nullable: false, Default: "NOW()"},
		},
		Indexes: []Index{
			{Name: "idx_wallets_user_id", Columns: []string{"user_id"}},
			{Name: "idx_wallets_currency", Columns: []string{"currency"}},
			{Name: "idx_wallets_address", Columns: []string{"address"}, Unique: true},
			{Name: "idx_wallets_chain", Columns: []string{"chain"}},
		},
		ForeignKeys: []ForeignKey{
			{Name: "fk_wallets_user_id", Columns: []string{"user_id"}, Referenced: TableReference{Table: "users", Columns: []string{"id"}, OnDelete: "CASCADE"}},
		},
	}
}

// GetOrdersTable returns orders table schema
func GetOrdersTable() Table {
	return Table{
		Name: "orders",
		Columns: []Column{
			{Name: "id", Type: "UUID", Nullable: false, Default: "gen_random_uuid()"},
			{Name: "user_id", Type: "UUID", Nullable: false},
			{Name: "symbol", Type: "VARCHAR(20)", Nullable: false, Description: "BTC/USDT"},
			{Name: "side", Type: "VARCHAR(10)", Nullable: false, Description: "BUY or SELL"},
			{Name: "type", Type: "VARCHAR(20)", Nullable: false, Description: "LIMIT, MARKET, STOP"},
			{Name: "quantity", Type: "DECIMAL(38,8)", Nullable: false},
			{Name: "price", Type: "DECIMAL(38,8)", Nullable: true},
			{Name: "stop_price", Type: "DECIMAL(38,8)", Nullable: true},
			{Name: "filled_quantity", Type: "DECIMAL(38,8)", Nullable: false, Default: "0"},
			{Name: "avg_fill_price", Type: "DECIMAL(38,8)", Nullable: true},
			{Name: "commission", Type: "DECIMAL(38,18)", Nullable: false, Default: "0"},
			{Name: "status", Type: "VARCHAR(20)", Nullable: false, Default: "'PENDING'"},
			{Name: "time_in_force", Type: "VARCHAR(10)", Nullable: false, Default: "'GTC'"},
			{Name: "created_at", Type: "TIMESTAMPTZ", Nullable: false, Default: "NOW()"},
			{Name: "updated_at", Type: "TIMESTAMPTZ", Nullable: false, Default: "NOW()"},
			{Name: "completed_at", Type: "TIMESTAMPTZ", Nullable: true},
		},
		Indexes: []Index{
			{Name: "idx_orders_user_id", Columns: []string{"user_id"}},
			{Name: "idx_orders_symbol", Columns: []string{"symbol"}},
			{Name: "idx_orders_status", Columns: []string{"status"}},
			{Name: "idx_orders_created_at", Columns: []string{"created_at"}},
			{Name: "idx_orders_user_symbol", Columns: []string{"user_id", "symbol"}},
		},
		ForeignKeys: []ForeignKey{
			{Name: "fk_orders_user_id", Columns: []string{"user_id"}, Referenced: TableReference{Table: "users", Columns: []string{"id"}, OnDelete: "CASCADE"}},
		},
	}
}

// GetTransactionsTable returns transactions table schema
func GetTransactionsTable() Table {
	return Table{
		Name: "transactions",
		Columns: []Column{
			{Name: "id", Type: "UUID", Nullable: false, Default: "gen_random_uuid()"},
			{Name: "user_id", Type: "UUID", Nullable: false},
			{Name: "wallet_id", Type: "UUID", Nullable: true},
			{Name: "type", Type: "VARCHAR(20)", Nullable: false, Description: "DEPOSIT, WITHDRAWAL, TRANSFER"},
			{Name: "currency", Type: "VARCHAR(20)", Nullable: false},
			{Name: "amount", Type: "DECIMAL(38,18)", Nullable: false},
			{Name: "fee", Type: "DECIMAL(38,18)", Nullable: false, Default: "0"},
			{Name: "status", Type: "VARCHAR(20)", Nullable: false, Default: "'PENDING'"},
			{Name: "tx_hash", Type: "VARCHAR(100)", Nullable: true, Description: "Blockchain transaction hash"},
			{Name: "from_address", Type: "VARCHAR(100)", Nullable: true},
			{Name: "to_address", Type: "VARCHAR(100)", Nullable: true},
			{Name: "confirmations", Type: "INT", Nullable: false, Default: "0"},
			{Name: "required_confirmations", Type: "INT", Nullable: false, Default: "6"},
			{Name: "created_at", Type: "TIMESTAMPTZ", Nullable: false, Default: "NOW()"},
			{Name: "updated_at", Type: "TIMESTAMPTZ", Nullable: false, Default: "NOW()"},
			{Name: "completed_at", Type: "TIMESTAMPTZ", Nullable: true},
		},
		Indexes: []Index{
			{Name: "idx_transactions_user_id", Columns: []string{"user_id"}},
			{Name: "idx_transactions_wallet_id", Columns: []string{"wallet_id"}},
			{Name: "idx_transactions_currency", Columns: []string{"currency"}},
			{Name: "idx_transactions_status", Columns: []string{"status"}},
			{Name: "idx_transactions_tx_hash", Columns: []string{"tx_hash"}},
			{Name: "idx_transactions_created_at", Columns: []string{"created_at"}},
		},
		ForeignKeys: []ForeignKey{
			{Name: "fk_transactions_user_id", Columns: []string{"user_id"}, Referenced: TableReference{Table: "users", Columns: []string{"id"}, OnDelete: "CASCADE"}},
			{Name: "fk_transactions_wallet_id", Columns: []string{"wallet_id"}, Referenced: TableReference{Table: "wallets", Columns: []string{"id"}, OnDelete: "SET NULL"}},
		},
	}
}

// GetTradesTable returns trades table schema
func GetTradesTable() Table {
	return Table{
		Name: "trades",
		Columns: []Column{
			{Name: "id", Type: "UUID", Nullable: false, Default: "gen_random_uuid()"},
			{Name: "order_id", Type: "UUID", Nullable: false},
			{Name: "match_id", Type: "UUID", Nullable: false, Description: "Match/Trade ID from matching engine"},
			{Name: "symbol", Type: "VARCHAR(20)", Nullable: false},
			{Name: "side", Type: "VARCHAR(10)", Nullable: false},
			{Name: "price", Type: "DECIMAL(38,8)", Nullable: false},
			{Name: "quantity", Type: "DECIMAL(38,8)", Nullable: false},
			{Name: "commission", Type: "DECIMAL(38,18)", Nullable: false, Default: "0"},
			{Name: "commission_currency", Type: "VARCHAR(20)", Nullable: false},
			{Name: "created_at", Type: "TIMESTAMPTZ", Nullable: false, Default: "NOW()"},
		},
		Indexes: []Index{
			{Name: "idx_trades_order_id", Columns: []string{"order_id"}},
			{Name: "idx_trades_match_id", Columns: []string{"match_id"}, Unique: true},
			{Name: "idx_trades_symbol", Columns: []string{"symbol"}},
			{Name: "idx_trades_created_at", Columns: []string{"created_at"}},
		},
		ForeignKeys: []ForeignKey{
			{Name: "fk_trades_order_id", Columns: []string{"order_id"}, Referenced: TableReference{Table: "orders", Columns: []string{"id"}, OnDelete: "CASCADE"}},
		},
	}
}

// GetPositionsTable returns positions table schema
func GetPositionsTable() Table {
	return Table{
		Name: "positions",
		Columns: []Column{
			{Name: "id", Type: "UUID", Nullable: false, Default: "gen_random_uuid()"},
			{Name: "user_id", Type: "UUID", Nullable: false},
			{Name: "symbol", Type: "VARCHAR(20)", Nullable: false, Description: "BTC-PERP"},
			{Name: "side", Type: "VARCHAR(10)", Nullable: false, Description: "LONG or SHORT"},
			{Name: "quantity", Type: "DECIMAL(38,8)", Nullable: false},
			{Name: "entry_price", Type: "DECIMAL(38,8)", Nullable: false},
			{Name: "mark_price", Type: "DECIMAL(38,8)", Nullable: true},
			{Name: "leverage", Type: "INT", Nullable: false, Default: "1"},
			{Name: "margin", Type: "DECIMAL(38,18)", Nullable: false},
			{Name: "unrealized_pnl", Type: "DECIMAL(38,18)", Nullable: false, Default: "0"},
			{Name: "realized_pnl", Type: "DECIMAL(38,18)", Nullable: false, Default: "0"},
			{Name: "liquidation_price", Type: "DECIMAL(38,8)", Nullable: true},
			{Name: "status", Type: "VARCHAR(20)", Nullable: false, Default: "'OPEN'"},
			{Name: "created_at", Type: "TIMESTAMPTZ", Nullable: false, Default: "NOW()"},
			{Name: "updated_at", Type: "TIMESTAMPTZ", Nullable: false, Default: "NOW()"},
			{Name: "closed_at", Type: "TIMESTAMPTZ", Nullable: true},
		},
		Indexes: []Index{
			{Name: "idx_positions_user_id", Columns: []string{"user_id"}},
			{Name: "idx_positions_symbol", Columns: []string{"symbol"}},
			{Name: "idx_positions_status", Columns: []string{"status"}},
		},
		ForeignKeys: []ForeignKey{
			{Name: "fk_positions_user_id", Columns: []string{"user_id"}, Referenced: TableReference{Table: "users", Columns: []string{"id"}, OnDelete: "CASCADE"}},
		},
	}
}

// GetKYCRecordsTable returns KYC records table schema
func GetKYCRecordsTable() Table {
	return Table{
		Name: "kyc_records",
		Columns: []Column{
			{Name: "id", Type: "UUID", Nullable: false, Default: "gen_random_uuid()"},
			{Name: "user_id", Type: "UUID", Nullable: false},
			{Name: "level", Type: "INT", Nullable: false, Default: "0"},
			{Name: "status", Type: "VARCHAR(20)", Nullable: false, Default: "'PENDING'"},
			{Name: "first_name", Type: "VARCHAR(100)", Nullable: true},
			{Name: "last_name", Type: "VARCHAR(100)", Nullable: true},
			{Name: "date_of_birth", Type: "DATE", Nullable: true},
			{Name: "nationality", Type: "VARCHAR(2)", Nullable: true},
			{Name: "id_type", Type: "VARCHAR(20)", Nullable: true, Description: "PASSPORT, ID_CARD, DRIVERS_LICENSE"},
			{Name: "id_number", Type: "VARCHAR(50)", Nullable: true},
			{Name: "id_front_url", Type: "TEXT", Nullable: true},
			{Name: "id_back_url", Type: "TEXT", Nullable: true},
			{Name: "selfie_url", Type: "TEXT", Nullable: true},
			{Name: "address_proof_url", Type: "TEXT", Nullable: true},
			{Name: "aml_check_status", Type: "VARCHAR(20)", Nullable: false, Default: "'PENDING'"},
			{Name: "risk_score", Type: "FLOAT", Nullable: false, Default: "0"},
			{Name: "rejection_reason", Type: "TEXT", Nullable: true},
			{Name: "submitted_at", Type: "TIMESTAMPTZ", Nullable: true},
			{Name: "reviewed_at", Type: "TIMESTAMPTZ", Nullable: true},
			{Name: "created_at", Type: "TIMESTAMPTZ", Nullable: false, Default: "NOW()"},
			{Name: "updated_at", Type: "TIMESTAMPTZ", Nullable: false, Default: "NOW()"},
		},
		Indexes: []Index{
			{Name: "idx_kyc_records_user_id", Columns: []string{"user_id"}, Unique: true},
			{Name: "idx_kyc_records_status", Columns: []string{"status"}},
		},
		ForeignKeys: []ForeignKey{
			{Name: "fk_kyc_records_user_id", Columns: []string{"user_id"}, Referenced: TableReference{Table: "users", Columns: []string{"id"}, OnDelete: "CASCADE"}},
		},
	}
}

// GetFeeCollectionTable returns fee collection table schema
func GetFeeCollectionTable() Table {
	return Table{
		Name: "fee_collections",
		Columns: []Column{
			{Name: "id", Type: "UUID", Nullable: false, Default: "gen_random_uuid()"},
			{Name: "user_id", Type: "UUID", Nullable: false},
			{Name: "source", Type: "VARCHAR(30)", Nullable: false, Description: "EXCHANGE, DEX, BRIDGE, WALLET"},
			{Name: "type", Type: "VARCHAR(30)", Nullable: false, Description: "TRADING, SWAP, BRIDGE, TRANSACTION"},
			{Name: "currency", Type: "VARCHAR(20)", Nullable: false},
			{Name: "amount", Type: "DECIMAL(38,18)", Nullable: false},
			{Name: "fee_amount", Type: "DECIMAL(38,18)", Nullable: false},
			{Name: "volume", Type: "DECIMAL(38,8)", Nullable: true, Description: "Trade volume for fee calculation"},
			{Name: "reference_id", Type: "VARCHAR(100)", Nullable: true, Description: "Order/Trade ID"},
			{Name: "created_at", Type: "TIMESTAMPTZ", Nullable: false, Default: "NOW()"},
		},
		Indexes: []Index{
			{Name: "idx_fee_collections_user_id", Columns: []string{"user_id"}},
			{Name: "idx_fee_collections_source", Columns: []string{"source"}},
			{Name: "idx_fee_collections_type", Columns: []string{"type"}},
			{Name: "idx_fee_collections_currency", Columns: []string{"currency"}},
			{Name: "idx_fee_collections_created_at", Columns: []string{"created_at"}},
		},
	}
}

// GetAuditLogsTable returns audit logs table schema
func GetAuditLogsTable() Table {
	return Table{
		Name: "audit_logs",
		Columns: []Column{
			{Name: "id", Type: "UUID", Nullable: false, Default: "gen_random_uuid()"},
			{Name: "user_id", Type: "UUID", Nullable: true},
			{Name: "action", Type: "VARCHAR(50)", Nullable: false, Description: "CREATE, UPDATE, DELETE, LOGIN, etc."},
			{Name: "resource", Type: "VARCHAR(50)", Nullable: false, Description: "USER, ORDER, WALLET, etc."},
			{Name: "resource_id", Type: "VARCHAR(100)", Nullable: true},
			{Name: "details", Type: "JSONB", Nullable: true},
			{Name: "ip_address", Type: "INET", Nullable: true},
			{Name: "user_agent", Type: "TEXT", Nullable: true},
			{Name: "status", Type: "VARCHAR(20)", Nullable: false, Default: "'SUCCESS'"},
			{Name: "created_at", Type: "TIMESTAMPTZ", Nullable: false, Default: "NOW()"},
		},
		Indexes: []Index{
			{Name: "idx_audit_logs_user_id", Columns: []string{"user_id"}},
			{Name: "idx_audit_logs_action", Columns: []string{"action"}},
			{Name: "idx_audit_logs_resource", Columns: []string{"resource"}},
			{Name: "idx_audit_logs_created_at", Columns: []string{"created_at"}},
		},
	}
}

// =============================================================================
// SQL GENERATION
// =============================================================================

// GenerateCreateTableSQL generates CREATE TABLE statement
func GenerateCreateTableSQL(table Table) string {
	var sb strings.Builder
	
	sb.WriteString(fmt.Sprintf("CREATE TABLE IF NOT EXISTS %s (\n", table.Name))
	
	// Columns
	for i, col := range table.Columns {
		sb.WriteString(fmt.Sprintf("    %s %s", col.Name, col.Type))
		if !col.Nullable {
			sb.WriteString(" NOT NULL")
		}
		if col.Default != "" {
			sb.WriteString(fmt.Sprintf(" DEFAULT %s", col.Default))
		}
		if i < len(table.Columns)-1 || len(table.ForeignKeys) > 0 {
			sb.WriteString(",\n")
		}
	}
	
	// Primary key (first column)
	sb.WriteString(fmt.Sprintf("    PRIMARY KEY (%s)", table.Columns[0].Name))
	
	// Foreign keys
	for _, fk := range table.ForeignKeys {
		sb.WriteString(fmt.Sprintf(",\n    FOREIGN KEY (%s) REFERENCES %s(%s) ON DELETE %s ON UPDATE %s",
			strings.Join(fk.Columns, ", "),
			fk.Referenced.Table,
			strings.Join(fk.Referenced.Columns, ", "),
			fk.Referenced.OnDelete,
			fk.Referenced.OnUpdate,
		))
	}
	
	sb.WriteString("\n)")
	
	// Comment
	sb.WriteString(fmt.Sprintf(";\n\nCOMMENT ON TABLE %s IS '%s';", table.Name, getTableComment(table.Name)))
	
	// Column comments
	for _, col := range table.Columns {
		if col.Description != "" {
			sb.WriteString(fmt.Sprintf("\nCOMMENT ON COLUMN %s.%s IS '%s';", table.Name, col.Name, col.Description))
		}
	}
	
	// Indexes
	for _, idx := range table.Indexes {
		unique := ""
		if idx.Unique {
			unique = "UNIQUE "
		}
		sb.WriteString(fmt.Sprintf("\nCREATE %sINDEX IF NOT EXISTS %s ON %s (%s);",
			unique, idx.Name, table.Name, strings.Join(idx.Columns, ", ")))
	}
	
	return sb.String()
}

func getTableComment(tableName string) string {
	comments := map[string]string{
		"users":          "User accounts and authentication",
		"wallets":        "User cryptocurrency wallets",
		"orders":         "Trading orders",
		"transactions":   "Blockchain transactions (deposits/withdrawals)",
		"trades":         "Trade executions",
		"positions":      "Derivatives positions",
		"kyc_records":    "KYC verification records",
		"fee_collections": "Fee collection records",
		"audit_logs":     "Audit trail for all actions",
	}
	if c, ok := comments[tableName]; ok {
		return c
	}
	return tableName
}

// GenerateFullSchema generates complete database schema
func GenerateFullSchema() string {
	var sb strings.Builder
	
	tables := []Table{
		GetUsersTable(),
		GetWalletsTable(),
		GetOrdersTable(),
		GetTransactionsTable(),
		GetTradesTable(),
		GetPositionsTable(),
		GetKYCRecordsTable(),
		GetFeeCollectionTable(),
		GetAuditLogsTable(),
	}
	
	// Header
	sb.WriteString("-- =============================================================================\n")
	sb.WriteString("-- TIGEREX DATABASE SCHEMA\n")
	sb.WriteString(fmt.Sprintf("-- Generated: %s\n", time.Now().Format(time.RFC3339)))
	sb.WriteString("-- =============================================================================\n\n")
	
	// Extensions
	sb.WriteString("-- Extensions\n")
	sb.WriteString("CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";\n")
	sb.WriteString("CREATE EXTENSION IF NOT EXISTS \"pgcrypto\";\n")
	sb.WriteString("CREATE EXTENSION IF NOT EXISTS \"hstore\";\n\n")
	
	// Tables
	for _, table := range tables {
		sb.WriteString("\n")
		sb.WriteString(GenerateCreateTableSQL(table))
		sb.WriteString("\n")
	}
	
	return sb.String()
}

// =============================================================================
// MAIN
// =============================================================================

func main() {
	fmt.Println("TigerEx Database Schema Generator")
	fmt.Println("==================================")
	
	// Generate full schema
	schema := GenerateFullSchema()
	
	// Print schema
	fmt.Println(schema)
	
	// Summary
	fmt.Println("\n\n-- SUMMARY")
	fmt.Println("-- Tables: 9")
	fmt.Println("-- Indexes: ~30")
	fmt.Println("-- Foreign Keys: 8")
}
