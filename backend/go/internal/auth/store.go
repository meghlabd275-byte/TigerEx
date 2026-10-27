package auth

import (
	"context"
	"errors"
	"time"

	"tigerex/backend/internal/api"
)

// ErrStoreUnavailable is returned when an operation needs durable state and no
// store has been configured.
//
// Every method that reads or writes a user used to be a no-op that returned
// "not found" or an empty slice. The effect was that registration appeared to
// succeed but stored nothing, login could never succeed, and an API key was
// returned to the caller with a secret that was never recorded anywhere. This
// sentinel makes the missing dependency explicit instead of silently
// fabricating a result.
var ErrStoreUnavailable = errors.New("auth persistence is not configured")

// Store is the persistence seam for authentication state. The Postgres
// implementation in this package is used in production; tests supply a real
// in-memory implementation.
type Store interface {
	CreateUser(ctx context.Context, user *api.User) error
	GetUserByID(ctx context.Context, userID string) (*api.User, error)
	GetUserByEmail(ctx context.Context, email string) (*api.User, error)
	UpdateUser(ctx context.Context, user *api.User) error

	UsernameExists(ctx context.Context, username string) (bool, error)
	EmailExists(ctx context.Context, email string) (bool, error)

	GetSettings(ctx context.Context, userID string) (*api.UserSettings, error)

	ListAPIKeys(ctx context.Context, userID string) ([]api.APIKey, error)
	CreateAPIKey(ctx context.Context, userID string, key *api.APIKey) error
	DeleteAPIKey(ctx context.Context, userID, keyID string) error
	GetAPIKeyByKeyID(ctx context.Context, keyID string) (*api.APIKey, error)

	// RecordFailedAttempt increments the failure counter for a user and returns
	// the new count.
	RecordFailedAttempt(ctx context.Context, userID string) (int, error)
	ClearFailedAttempts(ctx context.Context, userID string) error
	// IsLocked reports whether the account is currently locked out.
	IsLocked(ctx context.Context, userID string) (bool, error)

	// StoreResetToken records the hash of a password reset token.
	StoreResetToken(ctx context.Context, tokenHash, userID string, expiresAt time.Time) error
	// ConsumeResetToken returns the user ID for a valid, unused token hash and
	// invalidates it. It returns ErrInvalidToken when the token is unknown,
	// expired, or already used.
	ConsumeResetToken(ctx context.Context, tokenHash string) (string, error)
}

// WithStore returns the service with a persistence store attached.
func (s *Service) WithStore(store Store) *Service {
	s.store = store
	return s
}

// Store returns the configured store, or nil when persistence is unavailable.
func (s *Service) Store() Store {
	return s.store
}
