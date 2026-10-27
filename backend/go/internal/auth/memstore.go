package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"tigerex/backend/internal/api"
)

// MemStore is an in-memory Store. It is a real implementation, not a stub: it
// enforces uniqueness, tracks failed attempts, and expires reset tokens. It
// suits tests and single-process deployments. Multi-process deployments need
// the Postgres store so that all replicas share state.
type MemStore struct {
	mu sync.RWMutex

	usersByID    map[string]*api.User
	userIDByMail map[string]string
	userIDByUser map[string]string

	apiKeys   map[string][]api.APIKey
	failures  map[string]*failureState
	resetKeys map[string]resetEntry
	settings  map[string]*api.UserSettings

	maxAttempts   int
	lockoutWindow time.Duration
}

type failureState struct {
	count       int
	lockedUntil time.Time
}

type resetEntry struct {
	userID    string
	expiresAt time.Time
	used      bool
}

// NewMemStore returns an empty in-memory store. maxAttempts and lockoutWindow
// control account lockout; pass zero for maxAttempts to disable locking.
func NewMemStore(maxAttempts int, lockoutWindow time.Duration) *MemStore {
	return &MemStore{
		usersByID:     map[string]*api.User{},
		userIDByMail:  map[string]string{},
		userIDByUser:  map[string]string{},
		apiKeys:       map[string][]api.APIKey{},
		failures:      map[string]*failureState{},
		resetKeys:     map[string]resetEntry{},
		settings:      map[string]*api.UserSettings{},
		maxAttempts:   maxAttempts,
		lockoutWindow: lockoutWindow,
	}
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func normalizeUsername(username string) string {
	return strings.ToLower(strings.TrimSpace(username))
}

func (m *MemStore) CreateUser(_ context.Context, user *api.User) error {
	if user == nil || user.ID == "" {
		return errors.New("user and user id are required")
	}
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.usersByID[user.ID]; exists {
		return ErrUserExists
	}
	email := normalizeEmail(user.Email)
	if _, exists := m.userIDByMail[email]; exists {
		return ErrUserExists
	}
	if user.Username != "" {
		if _, exists := m.userIDByUser[normalizeUsername(user.Username)]; exists {
			return ErrUserExists
		}
	}

	clone := *user
	m.usersByID[user.ID] = &clone
	m.userIDByMail[email] = user.ID
	if user.Username != "" {
		m.userIDByUser[normalizeUsername(user.Username)] = user.ID
	}
	return nil
}

func (m *MemStore) GetUserByID(_ context.Context, userID string) (*api.User, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	u, ok := m.usersByID[userID]
	if !ok {
		return nil, ErrUserNotFound
	}
	clone := *u
	return &clone, nil
}

func (m *MemStore) GetUserByEmail(_ context.Context, email string) (*api.User, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	id, ok := m.userIDByMail[normalizeEmail(email)]
	if !ok {
		return nil, ErrUserNotFound
	}
	clone := *m.usersByID[id]
	return &clone, nil
}

func (m *MemStore) UpdateUser(_ context.Context, user *api.User) error {
	if user == nil || user.ID == "" {
		return ErrUserNotFound
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.usersByID[user.ID]; !ok {
		return ErrUserNotFound
	}
	clone := *user
	m.usersByID[user.ID] = &clone
	return nil
}

func (m *MemStore) UsernameExists(_ context.Context, username string) (bool, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	_, ok := m.userIDByUser[normalizeUsername(username)]
	return ok, nil
}

func (m *MemStore) EmailExists(_ context.Context, email string) (bool, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	_, ok := m.userIDByMail[normalizeEmail(email)]
	return ok, nil
}

func (m *MemStore) GetSettings(_ context.Context, userID string) (*api.UserSettings, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if _, ok := m.usersByID[userID]; !ok {
		return nil, ErrUserNotFound
	}
	if s, ok := m.settings[userID]; ok {
		clone := *s
		return &clone, nil
	}
	return &api.UserSettings{
		UserID:   userID,
		Language: "en",
		Timezone: "UTC",
		Theme:    "dark",
		Currency: "USD",
	}, nil
}

func (m *MemStore) ListAPIKeys(_ context.Context, userID string) ([]api.APIKey, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if _, ok := m.usersByID[userID]; !ok {
		return nil, ErrUserNotFound
	}
	keys := m.apiKeys[userID]
	out := make([]api.APIKey, len(keys))
	copy(out, keys)
	return out, nil
}

func (m *MemStore) CreateAPIKey(_ context.Context, userID string, key *api.APIKey) error {
	if key == nil || key.ID == "" {
		return errors.New("api key and id are required")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.usersByID[userID]; !ok {
		return ErrUserNotFound
	}
	for _, existing := range m.apiKeys[userID] {
		if existing.ID == key.ID {
			return errors.New("api key already exists")
		}
	}
	clone := *key
	m.apiKeys[userID] = append(m.apiKeys[userID], clone)
	return nil
}

func (m *MemStore) DeleteAPIKey(_ context.Context, userID, keyID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.usersByID[userID]; !ok {
		return ErrUserNotFound
	}
	keys := m.apiKeys[userID]
	for i, k := range keys {
		if k.ID == keyID {
			m.apiKeys[userID] = append(keys[:i:i], keys[i+1:]...)
			return nil
		}
	}
	return ErrInvalidToken
}

func (m *MemStore) GetAPIKeyByKeyID(_ context.Context, keyID string) (*api.APIKey, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, keys := range m.apiKeys {
		for _, k := range keys {
			if k.Key == keyID {
				clone := k
				return &clone, nil
			}
		}
	}
	return nil, ErrInvalidToken
}

func (m *MemStore) RecordFailedAttempt(_ context.Context, userID string) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.usersByID[userID]; !ok {
		return 0, ErrUserNotFound
	}
	state, ok := m.failures[userID]
	if !ok {
		state = &failureState{}
		m.failures[userID] = state
	}
	state.count++
	if m.maxAttempts > 0 && state.count >= m.maxAttempts {
		state.lockedUntil = time.Now().Add(m.lockoutWindow)
	}
	return state.count, nil
}

func (m *MemStore) ClearFailedAttempts(_ context.Context, userID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.failures, userID)
	return nil
}

func (m *MemStore) IsLocked(_ context.Context, userID string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	state, ok := m.failures[userID]
	if !ok {
		return false, nil
	}
	if state.lockedUntil.IsZero() {
		return false, nil
	}
	if time.Now().After(state.lockedUntil) {
		// The lockout has elapsed; start a fresh window.
		delete(m.failures, userID)
		return false, nil
	}
	return true, nil
}

func (m *MemStore) StoreResetToken(_ context.Context, tokenHash, userID string, expiresAt time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.usersByID[userID]; !ok {
		return ErrUserNotFound
	}
	m.resetKeys[tokenHash] = resetEntry{userID: userID, expiresAt: expiresAt}
	return nil
}

func (m *MemStore) ConsumeResetToken(_ context.Context, tokenHash string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	entry, ok := m.resetKeys[tokenHash]
	if !ok || entry.used || time.Now().After(entry.expiresAt) {
		return "", ErrInvalidToken
	}
	entry.used = true
	m.resetKeys[tokenHash] = entry
	return entry.userID, nil
}

// HashResetToken hashes a reset token for storage. Reset tokens are bearer
// credentials, so the store keeps only the digest and a database leak does not
// hand over the ability to reset any password.
func HashResetToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// SortedUserIDs returns the known user IDs in a stable order. It exists for
// tests and administrative reporting.
func (m *MemStore) SortedUserIDs() []string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	ids := make([]string, 0, len(m.usersByID))
	for id := range m.usersByID {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

var _ Store = (*MemStore)(nil)

// String makes a store safe to log without leaking user data.
func (m *MemStore) String() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return fmt.Sprintf("auth.MemStore{users:%d}", len(m.usersByID))
}
