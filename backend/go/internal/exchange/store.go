// Package exchange is the durable PostgreSQL data layer for the Go API gateway.
//
// It is the single production store behind the market-data, order, account and
// custody endpoints: every read comes from the database and every mutation runs
// in a transaction, so no endpoint has to fabricate a value when a dependency is
// missing. A store that cannot reach its database returns an error, which the
// HTTP layer turns into a 503, rather than a zero value that looks like data.
package exchange

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"tigerex/backend/internal/matching"
)

// ErrUnavailable is returned when a backing dependency is not configured or
// cannot be reached. Callers translate it into an "unavailable" response.
var ErrUnavailable = errors.New("exchange store is not available")

// Store is a PostgreSQL-backed implementation of the exchange data layer.
type Store struct {
	pool   *pgxpool.Pool
	hd     *HDDeriver
	engine *matching.Client
}

// New connects to PostgreSQL and verifies the connection.
func New(ctx context.Context, dsn string) (*Store, error) {
	if dsn == "" {
		return nil, fmt.Errorf("%w: empty DSN", ErrUnavailable)
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("connecting to postgres: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("pinging postgres: %w", err)
	}
	return &Store{pool: pool}, nil
}

// NewFromPool wraps an existing pool, so one connection pool serves the whole
// process instead of one per service.
func NewFromPool(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

// Close releases the connection pool.
func (s *Store) Close() {
	if s != nil && s.pool != nil {
		s.pool.Close()
	}
}

// Pool exposes the underlying pool for services that need it.
func (s *Store) Pool() *pgxpool.Pool {
	if s == nil {
		return nil
	}
	return s.pool
}

// withTx runs fn inside a transaction, rolling back on error or panic.
func (s *Store) withTx(ctx context.Context, fn func(pgx.Tx) error) error {
	if s == nil || s.pool == nil {
		return ErrUnavailable
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(ctx)
		}
	}()
	if err := fn(tx); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}
	committed = true
	return nil
}
