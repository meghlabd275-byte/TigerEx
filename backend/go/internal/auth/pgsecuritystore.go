package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"tigerex/backend/internal/api"
)

// securitySchemaSQL creates the tables the security store owns. They are
// separate from the main schema so a deployment can add them without a
// migration that touches the users table.
const securitySchemaSQL = `
CREATE TABLE IF NOT EXISTS withdrawal_addresses (
    id         UUID PRIMARY KEY,
    user_id    UUID NOT NULL,
    asset      VARCHAR(20) NOT NULL,
    network    VARCHAR(50) NOT NULL,
    address    VARCHAR(255) NOT NULL,
    memo       VARCHAR(255),
    label      VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, asset, address)
);

CREATE INDEX IF NOT EXISTS idx_withdrawal_addresses_user ON withdrawal_addresses(user_id);

CREATE TABLE IF NOT EXISTS api_key_ip_whitelist (
    api_key_id UUID PRIMARY KEY,
    user_id    UUID NOT NULL,
    rules      JSONB NOT NULL DEFAULT '[]',
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
`

// EnsureSecuritySchema creates the tables the security store owns.
func (s *PgStore) EnsureSecuritySchema(ctx context.Context) error {
	if _, err := s.pool.Exec(ctx, securitySchemaSQL); err != nil {
		return fmt.Errorf("ensuring security schema: %w", err)
	}
	return nil
}

// UpdateSettings writes the mutable user preferences.
func (s *PgStore) UpdateSettings(ctx context.Context, settings *api.UserSettings) error {
	if settings == nil || settings.UserID == "" {
		return errors.New("settings and userId are required")
	}
	const q = `
		UPDATE users SET
			language = COALESCE(NULLIF($2, ''), language),
			timezone = COALESCE(NULLIF($3, ''), timezone),
			theme = COALESCE(NULLIF($4, ''), theme),
			currency = COALESCE(NULLIF($5, ''), currency),
			anti_phishing_code = NULLIF($6, ''),
			updated_at = NOW()
		WHERE id = $1 AND deleted_at IS NULL
	`
	tag, err := s.pool.Exec(ctx, q, settings.UserID, settings.Language, settings.Timezone,
		settings.Theme, settings.Currency, settings.AntiPhishingCode)
	if err != nil {
		return fmt.Errorf("updating settings: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrUserNotFound
	}
	return nil
}

// ListWithdrawalAddresses returns a user's approved addresses.
func (s *PgStore) ListWithdrawalAddresses(ctx context.Context, userID string) ([]api.WithdrawalAddress, error) {
	const q = `
		SELECT id::text, user_id::text, asset, network, address, COALESCE(memo, ''),
		       COALESCE(label, ''), COALESCE(EXTRACT(EPOCH FROM created_at)::bigint, 0)
		FROM withdrawal_addresses WHERE user_id = $1 ORDER BY asset, address
	`
	rows, err := s.pool.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("listing withdrawal addresses: %w", err)
	}
	defer rows.Close()

	var out []api.WithdrawalAddress
	for rows.Next() {
		var a api.WithdrawalAddress
		if err := rows.Scan(&a.ID, &a.UserID, &a.Asset, &a.Network, &a.Address, &a.Memo, &a.Label, &a.CreatedAt); err != nil {
			return nil, fmt.Errorf("scanning withdrawal address: %w", err)
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating withdrawal addresses: %w", err)
	}
	return out, nil
}

// AddWithdrawalAddress records an approved address.
func (s *PgStore) AddWithdrawalAddress(ctx context.Context, entry *api.WithdrawalAddress) error {
	if entry == nil || entry.UserID == "" || entry.ID == "" {
		return errors.New("entry, userId, and id are required")
	}
	const q = `
		INSERT INTO withdrawal_addresses (id, user_id, asset, network, address, memo, label, created_at)
		VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''), NULLIF($7, ''), NOW())
	`
	_, err := s.pool.Exec(ctx, q, entry.ID, entry.UserID, entry.Asset, entry.Network,
		entry.Address, entry.Memo, entry.Label)
	if err != nil {
		if isUniqueViolation(err) {
			return ErrDuplicateAddress
		}
		return fmt.Errorf("adding withdrawal address: %w", err)
	}
	return nil
}

// RemoveWithdrawalAddress deletes an approved address.
func (s *PgStore) RemoveWithdrawalAddress(ctx context.Context, userID, addressID string) error {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM withdrawal_addresses WHERE user_id = $1 AND id = $2`, userID, addressID)
	if err != nil {
		return fmt.Errorf("removing withdrawal address: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return errors.New("address not found")
	}
	return nil
}

// SetAPIKeyIPWhitelist replaces the IP allowlist for one API key.
func (s *PgStore) SetAPIKeyIPWhitelist(ctx context.Context, userID, keyID string, cidrs []string) error {
	encoded, err := json.Marshal(cidrs)
	if err != nil {
		return fmt.Errorf("encoding ip whitelist: %w", err)
	}
	// The key must belong to the caller; the WHERE on the sub-select enforces
	// that, so one user cannot change another user's key.
	const q = `
		INSERT INTO api_key_ip_whitelist (api_key_id, user_id, rules, updated_at)
		SELECT id, $1, $3::jsonb, NOW() FROM api_keys WHERE id = $2 AND user_id = $1
		ON CONFLICT (api_key_id) DO UPDATE
		SET rules = EXCLUDED.rules, updated_at = NOW()
		WHERE api_key_ip_whitelist.user_id = $1
	`
	tag, err := s.pool.Exec(ctx, q, userID, keyID, string(encoded))
	if err != nil {
		return fmt.Errorf("setting ip whitelist: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return errors.New("api key not found")
	}
	return nil
}

// GetAPIKeyIPWhitelist returns the IP allowlist for one API key.
func (s *PgStore) GetAPIKeyIPWhitelist(ctx context.Context, userID, keyID string) ([]string, error) {
	const q = `
		SELECT COALESCE(rules::text, '[]') FROM api_key_ip_whitelist
		WHERE api_key_id = $1 AND user_id = $2
	`
	var raw string
	err := s.pool.QueryRow(ctx, q, keyID, userID).Scan(&raw)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("loading ip whitelist: %w", err)
	}

	var rules []string
	if err := json.Unmarshal([]byte(raw), &rules); err != nil {
		return nil, fmt.Errorf("decoding ip whitelist: %w", err)
	}
	return rules, nil
}

// BumpSecurityVersion increments the user's security version and returns the
// new value.
func (s *PgStore) BumpSecurityVersion(ctx context.Context, userID string) (int64, error) {
	const q = `
		UPDATE users SET security_version = security_version + 1, updated_at = NOW()
		WHERE id = $1 AND deleted_at IS NULL
		RETURNING security_version
	`
	var version int64
	if err := s.pool.QueryRow(ctx, q, userID).Scan(&version); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, ErrUserNotFound
		}
		return 0, fmt.Errorf("bumping security version: %w", err)
	}
	return version, nil
}

// NormaliseIPList trims and de-duplicates a list of IP rules.
func NormaliseIPList(rules []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(rules))
	for _, rule := range rules {
		rule = strings.TrimSpace(rule)
		if rule == "" || seen[rule] {
			continue
		}
		seen[rule] = true
		out = append(out, rule)
	}
	return out
}

var _ SecurityStore = (*PgStore)(nil)
