package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"tigerex/backend/internal/api"
)

// PgStore is the production Store, backed by PostgreSQL.
//
// It uses the columns defined in internal/database/schema.sql for users and
// api_keys, and creates two auxiliary tables of its own for state that schema
// does not model: failed login counters and password reset tokens. Both tables
// are created on construction so a fresh database works without a manual step.
type PgStore struct {
	pool *pgxpool.Pool

	maxLoginAttempts int
	lockoutDuration  time.Duration
}

// NewPgStore connects to PostgreSQL and ensures the auxiliary tables exist.
func NewPgStore(ctx context.Context, dsn string, maxLoginAttempts int, lockoutDuration time.Duration) (*PgStore, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("connecting to postgres: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("pinging postgres: %w", err)
	}

	store := &PgStore{
		pool:             pool,
		maxLoginAttempts: maxLoginAttempts,
		lockoutDuration:  lockoutDuration,
	}
	if err := store.EnsureSchema(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return store, nil
}

// NewPgStoreFromPool wraps an existing pool.
func NewPgStoreFromPool(pool *pgxpool.Pool, maxLoginAttempts int, lockoutDuration time.Duration) *PgStore {
	return &PgStore{pool: pool, maxLoginAttempts: maxLoginAttempts, lockoutDuration: lockoutDuration}
}

// Close releases the connection pool.
func (s *PgStore) Close() {
	if s.pool != nil {
		s.pool.Close()
	}
}

const ensureSchemaSQL = `
CREATE TABLE IF NOT EXISTS auth_login_attempts (
    user_id      UUID PRIMARY KEY,
    failures     INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMP WITH TIME ZONE,
    updated_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id    UUID NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at    TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_auth_password_resets_user ON auth_password_resets(user_id);
`

// EnsureSchema creates the tables this store owns.
func (s *PgStore) EnsureSchema(ctx context.Context) error {
	if _, err := s.pool.Exec(ctx, ensureSchemaSQL); err != nil {
		return fmt.Errorf("ensuring auth schema: %w", err)
	}
	return nil
}

func (s *PgStore) CreateUser(ctx context.Context, user *api.User) error {
	const q = `
		INSERT INTO users (id, email, username, password_hash, phone, ref_code, referrer_id,
		                   two_factor_enabled, two_factor_secret, kyc_level, is_admin, created_at, updated_at)
		VALUES ($1, $2, $3, $4, NULLIF($5, ''), NULLIF($6, ''), NULLIF($7, '')::uuid,
		        $8, NULLIF($9, ''), $10, $11, to_timestamp($12), to_timestamp($13))
	`
	_, err := s.pool.Exec(ctx, q,
		user.ID, user.Email, user.Username, user.Password, user.Phone, user.RefCode, user.ReferrerID,
		user.TwoFactorEnabled, user.TwoFactorSecret, user.KYCLevel, user.IsAdmin,
		user.CreatedAt, user.UpdatedAt,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return ErrUserExists
		}
		return fmt.Errorf("creating user: %w", err)
	}
	return nil
}

const selectUserColumns = `
	SELECT id, email, username, password_hash, COALESCE(phone, ''), ref_code, COALESCE(referrer_id::text, ''),
	       two_factor_enabled, COALESCE(two_factor_secret, ''), kyc_level, is_admin,
	       EXTRACT(EPOCH FROM created_at)::bigint,
	       EXTRACT(EPOCH FROM updated_at)::bigint,
	       COALESCE(EXTRACT(EPOCH FROM last_login_at)::bigint, 0),
	       COALESCE(EXTRACT(EPOCH FROM locked_until)::bigint, 0),
	       COALESCE(security_version, 1)
	FROM users
`

func scanUser(row pgx.Row) (*api.User, error) {
	var u api.User
	err := row.Scan(
		&u.ID, &u.Email, &u.Username, &u.Password, &u.Phone, &u.RefCode, &u.ReferrerID,
		&u.TwoFactorEnabled, &u.TwoFactorSecret, &u.KYCLevel, &u.IsAdmin,
		&u.CreatedAt, &u.UpdatedAt, &u.LastLoginAt, &u.LockedUntil, &u.SecurityVersion,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, err
	}
	return &u, nil
}

func (s *PgStore) GetUserByID(ctx context.Context, userID string) (*api.User, error) {
	u, err := scanUser(s.pool.QueryRow(ctx, selectUserColumns+` WHERE id = $1 AND deleted_at IS NULL`, userID))
	if err != nil {
		return nil, wrapNotFound(err)
	}
	return u, nil
}

func (s *PgStore) GetUserByEmail(ctx context.Context, email string) (*api.User, error) {
	u, err := scanUser(s.pool.QueryRow(ctx, selectUserColumns+` WHERE lower(email) = lower($1) AND deleted_at IS NULL`, email))
	if err != nil {
		return nil, wrapNotFound(err)
	}
	return u, nil
}

func (s *PgStore) UpdateUser(ctx context.Context, user *api.User) error {
	const q = `
		UPDATE users SET
			email = $2, username = $3, password_hash = $4, phone = NULLIF($5, ''),
			two_factor_enabled = $6, two_factor_secret = NULLIF($7, ''), kyc_level = $8,
			is_admin = $9, updated_at = to_timestamp($10),
			last_login_at = CASE WHEN $11 > 0 THEN to_timestamp($11) ELSE last_login_at END,
			locked_until = CASE WHEN $12 > 0 THEN to_timestamp($12) ELSE locked_until END
		WHERE id = $1 AND deleted_at IS NULL
	`
	tag, err := s.pool.Exec(ctx, q,
		user.ID, user.Email, user.Username, user.Password, user.Phone,
		user.TwoFactorEnabled, user.TwoFactorSecret, user.KYCLevel, user.IsAdmin, user.UpdatedAt,
		user.LastLoginAt, user.LockedUntil,
	)
	if err != nil {
		return fmt.Errorf("updating user: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrUserNotFound
	}
	return nil
}

func (s *PgStore) UsernameExists(ctx context.Context, username string) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM users WHERE lower(username) = lower($1) AND deleted_at IS NULL)`,
		username).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("checking username: %w", err)
	}
	return exists, nil
}

func (s *PgStore) EmailExists(ctx context.Context, email string) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL)`,
		email).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("checking email: %w", err)
	}
	return exists, nil
}

func (s *PgStore) GetSettings(ctx context.Context, userID string) (*api.UserSettings, error) {
	const q = `
		SELECT COALESCE(language, 'en'), COALESCE(timezone, 'UTC'), COALESCE(theme, 'dark'),
		       COALESCE(currency, 'USD'), COALESCE(anti_phishing_code, '')
		FROM users WHERE id = $1 AND deleted_at IS NULL
	`
	var s2 api.UserSettings
	err := s.pool.QueryRow(ctx, q, userID).Scan(&s2.Language, &s2.Timezone, &s2.Theme, &s2.Currency, &s2.AntiPhishingCode)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, fmt.Errorf("loading settings: %w", err)
	}
	s2.UserID = userID
	return &s2, nil
}

func (s *PgStore) ListAPIKeys(ctx context.Context, userID string) ([]api.APIKey, error) {
	const q = `
		SELECT id, label, COALESCE(permissions::text, '[]'), COALESCE(ip_whitelist::text, '[]'),
		       COALESCE(EXTRACT(EPOCH FROM expires_at)::bigint, 0),
		       EXTRACT(EPOCH FROM created_at)::bigint,
		       COALESCE(EXTRACT(EPOCH FROM last_used_at)::bigint, 0),
		       enabled
		FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC
	`
	rows, err := s.pool.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("listing api keys: %w", err)
	}
	defer rows.Close()

	var keys []api.APIKey
	for rows.Next() {
		var (
			k                      api.APIKey
			permissions, whitelist string
		)
		if err := rows.Scan(&k.ID, &k.Label, &permissions, &whitelist,
			&k.ExpiresAt, &k.CreatedAt, &k.LastUsed, &k.Enabled); err != nil {
			return nil, fmt.Errorf("scanning api key: %w", err)
		}
		k.Key = k.ID
		_ = json.Unmarshal([]byte(permissions), &k.Permissions)
		_ = json.Unmarshal([]byte(whitelist), &k.IPWhitelist)
		keys = append(keys, k)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating api keys: %w", err)
	}
	return keys, nil
}

func (s *PgStore) CreateAPIKey(ctx context.Context, userID string, key *api.APIKey) error {
	permissions, err := json.Marshal(key.Permissions)
	if err != nil {
		return fmt.Errorf("encoding permissions: %w", err)
	}
	whitelist, err := json.Marshal(key.IPWhitelist)
	if err != nil {
		return fmt.Errorf("encoding ip whitelist: %w", err)
	}

	const q = `
		INSERT INTO api_keys (id, user_id, key_hash, label, permissions, ip_whitelist, expires_at, created_at, enabled)
		VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb,
		        CASE WHEN $7 > 0 THEN to_timestamp($7) ELSE NULL END, to_timestamp($8), $9)
	`
	_, err = s.pool.Exec(ctx, q, key.ID, userID, key.Secret, key.Label,
		string(permissions), string(whitelist), key.ExpiresAt, key.CreatedAt, key.Enabled)
	if err != nil {
		return fmt.Errorf("creating api key: %w", err)
	}
	return nil
}

func (s *PgStore) DeleteAPIKey(ctx context.Context, userID, keyID string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM api_keys WHERE user_id = $1 AND id = $2`, userID, keyID)
	if err != nil {
		return fmt.Errorf("deleting api key: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrInvalidToken
	}
	return nil
}

func (s *PgStore) GetAPIKeyByKeyID(ctx context.Context, keyID string) (*api.APIKey, error) {
	const q = `
		SELECT id, user_id, key_hash, label, COALESCE(permissions::text, '[]'),
		       COALESCE(ip_whitelist::text, '[]'),
		       COALESCE(EXTRACT(EPOCH FROM expires_at)::bigint, 0),
		       EXTRACT(EPOCH FROM created_at)::bigint,
		       COALESCE(EXTRACT(EPOCH FROM last_used_at)::bigint, 0),
		       enabled
		FROM api_keys WHERE id = $1
	`
	var (
		k                      api.APIKey
		userID                 string
		permissions, whitelist string
	)
	err := s.pool.QueryRow(ctx, q, keyID).Scan(&k.ID, &userID, &k.Secret, &k.Label,
		&permissions, &whitelist, &k.ExpiresAt, &k.CreatedAt, &k.LastUsed, &k.Enabled)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrInvalidToken
		}
		return nil, fmt.Errorf("loading api key: %w", err)
	}
	k.Key = k.ID
	_ = json.Unmarshal([]byte(permissions), &k.Permissions)
	_ = json.Unmarshal([]byte(whitelist), &k.IPWhitelist)
	return &k, nil
}

func (s *PgStore) RecordFailedAttempt(ctx context.Context, userID string) (int, error) {
	const q = `
		INSERT INTO auth_login_attempts (user_id, failures, locked_until, updated_at)
		VALUES ($1, 1, NULL, NOW())
		ON CONFLICT (user_id) DO UPDATE
		SET failures = auth_login_attempts.failures + 1,
		    locked_until = CASE
		        WHEN $2 > 0 AND auth_login_attempts.failures + 1 >= $2
		        THEN NOW() + ($3 * INTERVAL '1 second')
		        ELSE auth_login_attempts.locked_until
		    END,
		    updated_at = NOW()
		RETURNING failures
	`
	var failures int
	err := s.pool.QueryRow(ctx, q, userID, s.maxLoginAttempts, int(s.lockoutDuration.Seconds())).Scan(&failures)
	if err != nil {
		return 0, fmt.Errorf("recording failed attempt: %w", err)
	}
	return failures, nil
}

func (s *PgStore) ClearFailedAttempts(ctx context.Context, userID string) error {
	if _, err := s.pool.Exec(ctx, `DELETE FROM auth_login_attempts WHERE user_id = $1`, userID); err != nil {
		return fmt.Errorf("clearing failed attempts: %w", err)
	}
	return nil
}

func (s *PgStore) IsLocked(ctx context.Context, userID string) (bool, error) {
	const q = `SELECT COALESCE(locked_until > NOW(), FALSE) FROM auth_login_attempts WHERE user_id = $1`
	var locked bool
	err := s.pool.QueryRow(ctx, q, userID).Scan(&locked)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("checking lock state: %w", err)
	}
	return locked, nil
}

func (s *PgStore) StoreResetToken(ctx context.Context, tokenHash, userID string, expiresAt time.Time) error {
	const q = `
		INSERT INTO auth_password_resets (token_hash, user_id, expires_at, used_at)
		VALUES ($1, $2, $3, NULL)
		ON CONFLICT (token_hash) DO UPDATE SET expires_at = $3, used_at = NULL
	`
	if _, err := s.pool.Exec(ctx, q, tokenHash, userID, expiresAt); err != nil {
		return fmt.Errorf("storing reset token: %w", err)
	}
	return nil
}

func (s *PgStore) ConsumeResetToken(ctx context.Context, tokenHash string) (string, error) {
	// The UPDATE only matches an unused, unexpired row, so two concurrent
	// requests cannot both consume the same token.
	const q = `
		UPDATE auth_password_resets
		SET used_at = NOW()
		WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
		RETURNING user_id::text
	`
	var userID string
	err := s.pool.QueryRow(ctx, q, tokenHash).Scan(&userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrInvalidToken
		}
		return "", fmt.Errorf("consuming reset token: %w", err)
	}
	return userID, nil
}

func wrapNotFound(err error) error {
	if errors.Is(err, ErrUserNotFound) {
		return err
	}
	return fmt.Errorf("querying user: %w", err)
}

// isUniqueViolation reports whether err is a Postgres unique-constraint error
// (SQLSTATE 23505) without importing the driver's error type directly.
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	var pgErr interface{ SQLState() string }
	if errors.As(err, &pgErr) {
		return pgErr.SQLState() == "23505"
	}
	return false
}

var _ Store = (*PgStore)(nil)
