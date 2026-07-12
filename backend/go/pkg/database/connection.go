package database

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
)

var (
	Pool *pgxpool.Pool
)

// Config holds database configuration
type Config struct {
	Host     string
	Port     int
	User     string
	Password string
	Database string
	MaxConns int32
	MinConns int32
}

// DefaultConfig returns default database configuration from environment
func DefaultConfig() *Config {
	return &Config{
		Host:     getEnv("DB_HOST", "localhost"),
		Port:     getEnvInt("DB_PORT", 5432),
		User:     getEnv("DB_USER", "tigerex"),
		Password: getEnv("DB_PASSWORD", ""),
		Database: getEnv("DB_NAME", "tigerex"),
		MaxConns: getEnvInt("DB_MAX_CONNS", 50),
		MinConns: getEnvInt("DB_MIN_CONNS", 10),
	}
}

// Connect establishes connection to PostgreSQL
func Connect(cfg *Config) (*pgxpool.Pool, error) {
	connStr := fmt.Sprintf(
		"postgres://%s:%s@%s:%d/%s?sslmode=disable&pool_max_conns=%d&pool_min_conns=%d",
		cfg.User,
		cfg.Password,
		cfg.Host,
		cfg.Port,
		cfg.Database,
		cfg.MaxConns,
		cfg.MinConns,
	)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	config, err := pgxpool.ParseConfig(connStr)
	if err != nil {
		return nil, fmt.Errorf("failed to parse config: %w", err)
	}

	config.MaxConns = cfg.MaxConns
	config.MinConns = cfg.MinConns
	config.MaxConnLifetime = time.Hour
	config.MaxConnIdleTime = 30 * time.Minute

	if err := config.CheckConn(ctx); err != nil {
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	Pool, err = pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("failed to create pool: %w", err)
	}

	if err := Pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	fmt.Println("✅ Database connected successfully")
	return Pool, nil
}

// ConnectFromEnv connects using environment variables
func ConnectFromEnv() (*pgxpool.Pool, error) {
	return Connect(DefaultConfig())
}

// CreateDatabase creates the database if it doesn't exist
func CreateDatabase(cfg *Config) error {
	connStr := fmt.Sprintf(
		"postgres://%s:%s@%s:%d/postgres?sslmode=disable",
		cfg.User,
		cfg.Password,
		cfg.Host,
		cfg.Port,
	)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	conn, err := pgxpool.Parse(connStr)
	if err != nil {
		return fmt.Errorf("failed to connect to postgres: %w", err)
	}
	defer conn.Close()

	var exists bool
	err = conn.QueryRow(ctx, "SELECT EXISTS(SELECT FROM pg_database WHERE datname = $1)", cfg.Database).Scan(&exists)
	if err != nil {
		return fmt.Errorf("failed to check database existence: %w", err)
	}

	if !exists {
		conn, err := pgxpool.Parse(connStr)
		if err != nil {
			return err
		}
		_, err = conn.Exec(ctx, fmt.Sprintf("CREATE DATABASE %s", cfg.Database))
		if err != nil {
			return fmt.Errorf("failed to create database: %w", err)
		}
		fmt.Printf("✅ Database '%s' created\n", cfg.Database)
	}

	return nil
}

// Initialize runs all database setup
func Initialize(cfg *Config) error {
	if err := CreateDatabase(cfg); err != nil {
		return err
	}

	pool, err := Connect(cfg)
	if err != nil {
		return err
	}

	Pool = pool
	return nil
}

// Close closes the database connection
func Close() {
	if Pool != nil {
		Pool.Close()
		fmt.Println("✅ Database connection closed")
	}
}

// HealthCheck checks database health
func HealthCheck(ctx context.Context) error {
	if Pool == nil {
		return fmt.Errorf("database not connected")
	}
	return Pool.Ping(ctx)
}

// Transaction executes a function within a transaction
func Transaction(ctx context.Context, fn func(tx interface{}) error) error {
	if Pool == nil {
		return fmt.Errorf("database not connected")
	}

	tx, err := Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}

	if err := fn(tx); err != nil {
		if rbErr := tx.Rollback(ctx); rbErr != nil {
			return fmt.Errorf("rollback failed: %v (original error: %w)", rbErr, err)
		}
		return err
	}

	return tx.Commit(ctx)
}

// QueryRow is a helper for single row queries
func QueryRow(ctx context.Context, sql string, args ...interface{}) (interface{}, error) {
	if Pool == nil {
		return nil, fmt.Errorf("database not connected")
	}
	var result interface{}
	err := Pool.QueryRow(ctx, sql, args...).Scan(&result)
	return result, err
}

// Query is a helper for queries
func Query(ctx context.Context, sql string, args ...interface{}) (interface{}, error) {
	if Pool == nil {
		return nil, fmt.Errorf("database not connected")
	}
	rows, err := Pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return rows, nil
}

// Exec executes a command
func Exec(ctx context.Context, sql string, args ...interface{}) (int64, error) {
	if Pool == nil {
		return 0, fmt.Errorf("database not connected")
	}
	result, err := Pool.Exec(ctx, sql, args...)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected(), nil
}

// Helper functions
func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		var intVal int
		if _, err := fmt.Sscanf(value, "%d", &intVal); err == nil {
			return intVal
		}
	}
	return defaultValue
}

// Import for pgxpool
import (
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)
