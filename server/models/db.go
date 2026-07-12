// Database Models and Initialization - Go + PostgreSQL
package models

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math/big"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/google/uuid"
)

var Pool *pgxpool.Pool

// Config holds database configuration
type Config struct {
	Host     string
	Port     string
	User     string
	Password string
	DBName   string
}

// GetConfig returns database configuration from environment
func GetConfig() Config {
	return Config{
		Host:     getEnv("DB_HOST", "localhost"),
		Port:     getEnv("DB_PORT", "5432"),
		User:     getEnv("DB_USER", "postgres"),
		Password: getEnv("DB_PASSWORD", "postgres"),
		DBName:   getEnv("DB_NAME", "tigerex"),
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// Connect to database
func InitDB() error {
	cfg := GetConfig()
	
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		url = fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=disable",
			cfg.User, cfg.Password, cfg.Host, cfg.Port, cfg.DBName)
	}

	config, err := pgxpool.ParseConfig(url)
	if err != nil {
		return fmt.Errorf("failed to parse database config: %v", err)
	}

	// Configure connection pool
	config.MaxConns = 50
	config.MinConns = 10
	config.MaxConnLifetime = time.Hour
	config.MaxConnIdleTime = 30 * time.Minute

	ctx := context.Background()
	Pool, err = pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return fmt.Errorf("failed to connect to database: %v", err)
	}

	// Test connection
	if err := Pool.Ping(ctx); err != nil {
		return fmt.Errorf("failed to ping database: %v", err)
	}

	// Run migrations
	if err := runMigrations(ctx); err != nil {
		return fmt.Errorf("failed to run migrations: %v", err)
	}

	fmt.Println("✓ Database connected")
	return nil
}

func CloseDB() {
	if Pool != nil {
		Pool.Close()
	}
}

func runMigrations(ctx context.Context) error {
	migrations := []string{
		// Users
		`CREATE TABLE IF NOT EXISTS users (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			email VARCHAR(255) UNIQUE NOT NULL,
			username VARCHAR(100) UNIQUE NOT NULL,
			password_hash VARCHAR(255) NOT NULL,
			password_salt VARCHAR(255) NOT NULL,
			kyc_level INTEGER DEFAULT 0 CHECK (kyc_level BETWEEN 0 AND 3),
			status VARCHAR(20) DEFAULT 'active',
			email_verified BOOLEAN DEFAULT FALSE,
			phone_verified BOOLEAN DEFAULT FALSE,
			two_factor_enabled BOOLEAN DEFAULT FALSE,
			two_factor_secret VARCHAR(255),
			referral_code VARCHAR(50) UNIQUE,
			risk_category VARCHAR(20) DEFAULT 'standard',
			jurisdiction VARCHAR(3) DEFAULT 'USA',
			wallet_address VARCHAR(255),
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			last_login_at TIMESTAMP WITH TIME ZONE
		)`,
		`CREATE TABLE IF NOT EXISTS sessions (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			session_token VARCHAR(255) UNIQUE NOT NULL,
			refresh_token VARCHAR(255),
			ip_address INET,
			user_agent TEXT,
			expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			status VARCHAR(20) DEFAULT 'active'
		)`,
		`CREATE TABLE IF NOT EXISTS user_profiles (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			first_name VARCHAR(100),
			last_name VARCHAR(100),
			avatar_url TEXT,
			language_preference VARCHAR(10) DEFAULT 'en',
			timezone VARCHAR(50) DEFAULT 'UTC',
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,

		// Wallets
		`CREATE TABLE IF NOT EXISTS wallets (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			currency VARCHAR(20) NOT NULL,
			network VARCHAR(50) NOT NULL,
			wallet_type VARCHAR(20) DEFAULT 'spot',
			balance NUMERIC(32, 16) DEFAULT 0,
			locked NUMERIC(32, 16) DEFAULT 0,
			available NUMERIC(32, 16) DEFAULT 0,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			UNIQUE(user_id, currency, network, wallet_type)
		)`,
		`CREATE TABLE IF NOT EXISTS wallet_addresses (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			currency VARCHAR(20) NOT NULL,
			network VARCHAR(50) NOT NULL,
			address TEXT NOT NULL,
			address_tag TEXT,
			is_default BOOLEAN DEFAULT FALSE,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			UNIQUE(user_id, currency, network, address)
		)`,
		`CREATE TABLE IF NOT EXISTS transactions (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			type VARCHAR(50) NOT NULL,
			currency VARCHAR(20) NOT NULL,
			amount NUMERIC(32, 16) NOT NULL,
			fee NUMERIC(32, 16) DEFAULT 0,
			status VARCHAR(20) DEFAULT 'pending',
			tx_hash TEXT,
			from_address TEXT,
			to_address TEXT,
			network VARCHAR(50),
			memo TEXT,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			completed_at TIMESTAMP WITH TIME ZONE
		)`,

		// Markets
		`CREATE TABLE IF NOT EXISTS markets (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			symbol VARCHAR(50) UNIQUE NOT NULL,
			base_currency VARCHAR(20) NOT NULL,
			quote_currency VARCHAR(20) NOT NULL,
			price_precision INTEGER DEFAULT 8,
			quantity_precision INTEGER DEFAULT 8,
			min_quantity NUMERIC(32, 16) DEFAULT 0,
			max_quantity NUMERIC(32, 16),
			maker_fee NUMERIC(10, 6) DEFAULT 0.001,
			taker_fee NUMERIC(10, 6) DEFAULT 0.001,
			status VARCHAR(20) DEFAULT 'active',
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,

		// Spot Orders
		`CREATE TABLE IF NOT EXISTS spot_orders (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			market_symbol VARCHAR(50) NOT NULL,
			side VARCHAR(10) NOT NULL,
			order_type VARCHAR(20) NOT NULL,
			quantity NUMERIC(32, 16) NOT NULL,
			price NUMERIC(32, 16),
			stop_price NUMERIC(32, 16),
			filled_quantity NUMERIC(32, 16) DEFAULT 0,
			average_price NUMERIC(32, 16) DEFAULT 0,
			commission NUMERIC(32, 16) DEFAULT 0,
			status VARCHAR(20) DEFAULT 'new',
			time_in_force VARCHAR(10) DEFAULT 'GTC',
			client_order_id VARCHAR(100),
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			completed_at TIMESTAMP WITH TIME ZONE
		)`,

		// Futures
		`CREATE TABLE IF NOT EXISTS futures_contracts (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			symbol VARCHAR(50) UNIQUE NOT NULL,
			base_currency VARCHAR(20) NOT NULL,
			quote_currency VARCHAR(20) NOT NULL,
			contract_type VARCHAR(20) DEFAULT 'perpetual',
			multiplier NUMERIC(32, 8) DEFAULT 1,
			size_limit NUMERIC(32, 16),
			price_precision INTEGER DEFAULT 4,
			maker_fee NUMERIC(10, 6) DEFAULT 0.0001,
			taker_fee NUMERIC(10, 6) DEFAULT 0.0004,
			status VARCHAR(20) DEFAULT 'active',
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS futures_positions (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			contract_symbol VARCHAR(50) NOT NULL,
			side VARCHAR(10) NOT NULL,
			size NUMERIC(32, 16) NOT NULL,
			entry_price NUMERIC(32, 16) NOT NULL,
			mark_price NUMERIC(32, 16),
			margin NUMERIC(32, 16) NOT NULL,
			leverage INTEGER DEFAULT 1,
			liq_price NUMERIC(32, 16),
			unrealized_pnl NUMERIC(32, 16) DEFAULT 0,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,

		// Margin
		`CREATE TABLE IF NOT EXISTS margin_accounts (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			borrowable NUMERIC(32, 16) DEFAULT 0,
			borrowed NUMERIC(32, 16) DEFAULT 0,
			interest_rate NUMERIC(10, 6) DEFAULT 0.0001,
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS margin_positions (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			currency VARCHAR(20) NOT NULL,
			borrowed NUMERIC(32, 16) DEFAULT 0,
			interest NUMERIC(32, 16) DEFAULT 0,
			collateral NUMERIC(32, 16) DEFAULT 0,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,

		// Options
		`CREATE TABLE IF NOT EXISTS options (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			symbol VARCHAR(50) UNIQUE NOT NULL,
			underlying VARCHAR(20) NOT NULL,
			strike_price NUMERIC(32, 8) NOT NULL,
			expiry_date TIMESTAMP WITH TIME ZONE NOT NULL,
			option_type VARCHAR(10) NOT NULL,
			contract_size NUMERIC(32, 8) DEFAULT 1,
			bid_price NUMERIC(32, 8),
			ask_price NUMERIC(32, 8),
			last_price NUMERIC(32, 8),
			volume NUMERIC(32, 16) DEFAULT 0,
			open_interest NUMERIC(32, 16) DEFAULT 0,
			status VARCHAR(20) DEFAULT 'active',
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS options_positions (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			option_id UUID NOT NULL,
			side VARCHAR(10) NOT NULL,
			quantity NUMERIC(32, 8) NOT NULL,
			entry_price NUMERIC(32, 8),
			current_value NUMERIC(32, 8),
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,

		// P2P
		`CREATE TABLE IF NOT EXISTS p2p_ads (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			type VARCHAR(10) NOT NULL,
			fiat_currency VARCHAR(10) NOT NULL,
			crypto_currency VARCHAR(10) NOT NULL,
			amount NUMERIC(32, 2) NOT NULL,
			price NUMERIC(32, 8) NOT NULL,
			price_type VARCHAR(10) DEFAULT 'fixed',
			float_margin NUMERIC(10, 4),
			payment_methods TEXT[],
			status VARCHAR(20) DEFAULT 'active',
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS p2p_trades (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			p2p_ad_id UUID NOT NULL,
			buyer_id UUID NOT NULL,
			seller_id UUID NOT NULL,
			amount NUMERIC(32, 2) NOT NULL,
			crypto_amount NUMERIC(32, 16) NOT NULL,
			status VARCHAR(20) DEFAULT 'pending',
			payment_proof TEXT,
			release_tx TEXT,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,

		// Earn
		`CREATE TABLE IF NOT EXISTS earn_products (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			name VARCHAR(100) NOT NULL,
			currency VARCHAR(20) NOT NULL,
			apy NUMERIC(10, 4) NOT NULL,
			min_amount NUMERIC(32, 16) DEFAULT 0,
			max_amount NUMERIC(32, 16),
			lock_period INTEGER DEFAULT 0,
			status VARCHAR(20) DEFAULT 'active',
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS earn_positions (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			product_id UUID NOT NULL,
			amount NUMERIC(32, 16) NOT NULL,
			reward NUMERIC(32, 16) DEFAULT 0,
			start_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			end_time TIMESTAMP WITH TIME ZONE,
			status VARCHAR(20) DEFAULT 'active'
		)`,

		// Staking
		`CREATE TABLE IF NOT EXISTS staking_pools (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			name VARCHAR(100) NOT NULL,
			currency VARCHAR(20) NOT NULL,
			apy NUMERIC(10, 4) NOT NULL,
			lock_period INTEGER DEFAULT 0,
			min_stake NUMERIC(32, 16) DEFAULT 0,
			max_stake NUMERIC(32, 16),
			total_staked NUMERIC(32, 16) DEFAULT 0,
			status VARCHAR(20) DEFAULT 'active',
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS staking_positions (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			pool_id VARCHAR(50) NOT NULL,
			amount NUMERIC(32, 16) NOT NULL,
			reward NUMERIC(32, 16) DEFAULT 0,
			lock_period INTEGER DEFAULT 0,
			start_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			end_time TIMESTAMP WITH TIME ZONE,
			status VARCHAR(20) DEFAULT 'active'
		)`,

		// Launchpad
		`CREATE TABLE IF NOT EXISTS launchpad_projects (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			name VARCHAR(100) NOT NULL,
			symbol VARCHAR(20) NOT NULL,
			description TEXT,
			total_raise NUMERIC(32, 2),
			token_price NUMERIC(32, 8),
			start_time TIMESTAMP WITH TIME ZONE,
			end_time TIMESTAMP WITH TIME ZONE,
			status VARCHAR(20) DEFAULT 'upcoming',
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS launchpad_subscriptions (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			project_id UUID NOT NULL,
			amount NUMERIC(32, 16) NOT NULL,
			allocated NUMERIC(32, 16),
			status VARCHAR(20) DEFAULT 'active',
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,

		// Rewards
		`CREATE TABLE IF NOT EXISTS rewards (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id UUID REFERENCES users(id) ON DELETE SET NULL,
			type VARCHAR(50) NOT NULL,
			amount NUMERIC(32, 16) NOT NULL,
			currency VARCHAR(20) NOT NULL,
			code VARCHAR(100),
			status VARCHAR(20) DEFAULT 'active',
			expires_at TIMESTAMP WITH TIME ZONE,
			used_at TIMESTAMP WITH TIME ZONE,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS kyc_documents (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			document_type VARCHAR(50) NOT NULL,
			document_number VARCHAR(100),
			front_url TEXT,
			back_url TEXT,
			selfie_url TEXT,
			status VARCHAR(20) DEFAULT 'pending',
			reject_reason TEXT,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,

		// Indexes
		`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
		`CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(session_token)`,
		`CREATE INDEX IF NOT EXISTS idx_orders_user ON spot_orders(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_orders_market ON spot_orders(market_symbol)`,
		`CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_wallets_user ON wallets(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_p2p_ads_user ON p2p_ads(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_futures_position_user ON futures_positions(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_margin_positions_user ON margin_positions(user_id)`,
	}

	for _, m := range migrations {
		if _, err := Pool.Exec(ctx, m); err != nil {
			return err
		}
	}

	return nil
}

// Seed default markets
func SeedMarkets() {
	ctx := context.Background()
	defaultMarkets := []struct {
		Symbol        string
		BaseCurrency string
		QuoteCurrency string
	}{
		{"BTC-USDT", "BTC", "USDT"},
		{"ETH-USDT", "ETH", "USDT"},
		{"BNB-USDT", "BNB", "USDT"},
		{"SOL-USDT", "SOL", "USDT"},
		{"XRP-USDT", "XRP", "USDT"},
		{"ADA-USDT", "ADA", "USDT"},
		{"DOGE-USDT", "DOGE", "USDT"},
		{"ETH-BTC", "ETH", "BTC"},
	}

	for _, m := range defaultMarkets {
		_, _ = Pool.Exec(ctx, `
			INSERT INTO markets (symbol, base_currency, quote_currency, status)
			VALUES ($1, $2, $3, 'active')
			ON CONFLICT (symbol) DO NOTHING
		`, m.Symbol, m.BaseCurrency, m.QuoteCurrency)
	}

	// Seed futures contracts
	futuresContracts := []struct {
		Symbol        string
		BaseCurrency string
		QuoteCurrency string
	}{
		{"BTC-USDT-PERP", "BTC", "USDT"},
		{"ETH-USDT-PERP", "ETH", "USDT"},
		{"BNB-USDT-PERP", "BNB", "USDT"},
		{"SOL-USDT-PERP", "SOL", "USDT"},
	}

	for _, c := range futuresContracts {
		_, _ = Pool.Exec(ctx, `
			INSERT INTO futures_contracts (symbol, base_currency, quote_currency, contract_type, status)
			VALUES ($1, $2, $3, 'perpetual', 'active')
			ON CONFLICT (symbol) DO NOTHING
		`, c.Symbol, c.BaseCurrency, c.QuoteCurrency)
	}

	// Seed earn products
	earnProducts := []struct {
		Name     string
		Currency string
		APY     float64
	}{
		{"USDT Flexible", "USDT", 4.5},
		{"USDT 30 Days", "USDT", 5.2},
		{"USDT 90 Days", "USDT", 6.5},
		{"ETH Flexible", "ETH", 3.8},
		{"BTC Flexible", "BTC", 2.5},
	}

	for _, p := range earnProducts {
		lockPeriod := 0
		if p.Name == "USDT 30 Days" {
			lockPeriod = 30
		} else if p.Name == "USDT 90 Days" {
			lockPeriod = 90
		}
		_, _ = Pool.Exec(ctx, `
			INSERT INTO earn_products (name, currency, apy, lock_period, status)
			VALUES ($1, $2, $3, $4, 'active')
			ON CONFLICT DO NOTHING
		`, p.Name, p.Currency, p.APY, lockPeriod)
	}

	// Seed staking pools
	stakingPools := []struct {
		Name     string
		Currency string
		APY     float64
	}{
		{"ETH 2.0", "ETH", 5.5},
		{"SOL 2.0", "SOL", 8.0},
		{"ATOM 2.0", "ATOM", 12.0},
	}

	for _, s := range stakingPools {
		_, _ = Pool.Exec(ctx, `
			INSERT INTO staking_pools (name, currency, apy, status)
			VALUES ($1, $2, $3, 'active')
			ON CONFLICT DO NOTHING
		`, s.Name, s.Currency, s.APY)
	}

	fmt.Println("✓ Seeded market data")
}

// Helper functions
func GenerateSalt() string {
	b := make([]byte, 32)
	rand.Read(b)
	return hex.EncodeToString(b)[:32]
}

func HashPassword(password, salt string) string {
	hash := sha256.Sum256([]byte(password + salt))
	return hex.EncodeToString(hash[:])
}

func ParseUUID(s string) (uuid.UUID, error) {
	return uuid.Parse(s)
}

func Now() time.Time {
	return time.Now().UTC()
}

func RandFloat64(max float64) float64 {
	f, _ := rand.Float64()
	return f * max
}