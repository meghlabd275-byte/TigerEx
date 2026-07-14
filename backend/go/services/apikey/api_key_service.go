// TigerEx API Key Management Service
// API keys for programmatic trading access

package apikey

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"sync"
	"time"
)

const (
	StatusActive    = "active"
	StatusSuspended = "suspended"
	StatusRevoked   = "revoked"

	PermissionRead  = "read"
	PermissionTrade = "trade"
	PermissionWithdraw = "withdraw"
	PermissionAll   = "all"
)

type APIKey struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	Name        string    `json:"name"`
	APIKey      string    `json:"api_key"`
	APISecret   string    `json:"api_secret"`
	PublicKey   string    `json:"public_key"`
	Permissions []string  `json:"permissions"`
	IPWhitelist []string  `json:"ip_whitelist"`
	RateLimit   int       `json:"rate_limit"`
	Status      string    `json:"status"`
	LastUsedAt  time.Time `json:"last_used_at"`
	ExpiresAt   time.Time `json:"expires_at"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type APIAccessLog struct {
	ID          string    `json:"id"`
	APIKeyID    string    `json:"api_key_id"`
	UserID      string    `json:"user_id"`
	IP          string    `json:"ip"`
	Endpoint    string    `json:"endpoint"`
	Method      string    `json:"method"`
	StatusCode  int       `json:"status_code"`
	LatencyMS   int64     `json:"latency_ms"`
	Timestamp   time.Time `json:"timestamp"`
}

type APIRateLimit struct {
	APIKeyID    string            `json:"api_key_id"`
	Requests    map[string]int64  `json:"requests"`
	LastReset   time.Time         `json:"last_reset"`
}

type APIKeyManager struct {
	mu          sync.RWMutex
	apiKeys     map[string]*APIKey
	userKeys    map[string][]string
	rateLimits  map[string]*APIRateLimit
	accessLogs  []APIAccessLog
}

func NewAPIKeyManager() *APIKeyManager {
	return &APIKeyManager{
		apiKeys:    make(map[string]*APIKey),
		userKeys:   make(map[string][]string),
		rateLimits: make(map[string]*APIRateLimit),
		accessLogs: make([]APIAccessLog, 0, 10000),
	}
}

func (akm *APIKeyManager) CreateAPIKey(userID, name string, permissions []string, ipWhitelist []string, rateLimit int, expiresInDays int) (*APIKey, error) {
	akm.mu.Lock()
	defer akm.mu.Unlock()

	// Validate permissions
	validPermissions := map[string]bool{
		PermissionRead: true,
		PermissionTrade: true,
		PermissionWithdraw: true,
		PermissionAll: true,
	}

	for _, p := range permissions {
		if !validPermissions[p] {
			return nil, fmt.Errorf("invalid permission: %s", p)
		}
	}

	// Generate API key and secret
	apiKey, err := generateSecureToken(32)
	if err != nil {
		return nil, err
	}

	apiSecret, err := generateSecureToken(48)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	var expiresAt *time.Time
	if expiresInDays > 0 {
		t := now.AddDate(0, 0, expiresInDays)
		expiresAt = &t
	}

	key := &APIKey{
		ID:          fmt.Sprintf("KEY%d%d", now.Unix(), now.Nanosecond()),
		UserID:      userID,
		Name:        name,
		APIKey:      apiKey,
		APISecret:   hashSecret(apiSecret),
		PublicKey:   apiKey[:8] + "..." + apiKey[len(apiKey)-4:],
		Permissions: permissions,
		IPWhitelist: ipWhitelist,
		RateLimit:   rateLimit,
		Status:      StatusActive,
		CreatedAt:   now,
		UpdatedAt:   now,
		ExpiresAt:   time.Time{},
	}

	if expiresAt != nil {
		key.ExpiresAt = *expiresAt
	}

	akm.apiKeys[key.APIKey] = key
	akm.userKeys[userID] = append(akm.userKeys[userID], key.APIKey)

	return key, nil
}

func (akm *APIKeyManager) ValidateAPIKey(apiKey, secret, ip string) (*APIKey, error) {
	akm.mu.RLock()
	defer akm.mu.RUnlock()

	key, exists := akm.apiKeys[apiKey]
	if !exists {
		return nil, errors.New("invalid API key")
	}

	// Verify secret
	if key.APISecret != hashSecret(secret) {
		return nil, errors.New("invalid API secret")
	}

	// Check status
	if key.Status != StatusActive {
		return nil, errors.New("API key is not active")
	}

	// Check expiration
	if !key.ExpiresAt.IsZero() && time.Now().After(key.ExpiresAt) {
		return nil, errors.New("API key has expired")
	}

	// Check IP whitelist
	if len(key.IPWhitelist) > 0 {
		allowed := false
		for _, allowedIP := range key.IPWhitelist {
			if allowedIP == ip || allowedIP == "*" {
				allowed = true
				break
			}
		}
		if !allowed {
			return nil, errors.New("IP address not allowed")
		}
	}

	// Update last used
	key.LastUsedAt = time.Now()

	return key, nil
}

func (akm *APIKeyManager) CheckPermission(key *APIKey, permission string) bool {
	for _, p := range key.Permissions {
		if p == PermissionAll || p == permission {
			return true
		}
	}
	return false
}

func (akm *APIKeyManager) GetAPIKeys(userID string) ([]*APIKey, error) {
	akm.mu.RLock()
	defer akm.mu.RUnlock()

	keyIDs, exists := akm.userKeys[userID]
	if !exists {
		return nil, nil
	}

	keys := make([]*APIKey, 0, len(keyIDs))
	for _, id := range keyIDs {
		if key, exists := akm.apiKeys[id]; exists {
			keys = append(keys, key)
		}
	}

	return keys, nil
}

func (akm *APIKeyManager) GetAPIKey(apiKeyID string) (*APIKey, error) {
	akm.mu.RLock()
	defer akm.mu.RUnlock()

	for _, key := range akm.apiKeys {
		if key.ID == apiKeyID {
			return key, nil
		}
	}

	return nil, errors.New("API key not found")
}

func (akm *APIKeyManager) RevokeAPIKey(apiKeyID, userID string) error {
	akm.mu.Lock()
	defer akm.mu.Unlock()

	for keyStr, key := range akm.apiKeys {
		if key.ID == apiKeyID && key.UserID == userID {
			key.Status = StatusRevoked
			key.UpdatedAt = time.Now()
			return nil
		}
	}

	return errors.New("API key not found")
}

func (akm *APIKeyManager) SuspendAPIKey(apiKeyID, userID string) error {
	akm.mu.Lock()
	defer akm.mu.Unlock()

	for keyStr, key := range akm.apiKeys {
		if key.ID == apiKeyID && key.UserID == userID {
			key.Status = StatusSuspended
			key.UpdatedAt = time.Now()
			return nil
		}
	}

	return errors.New("API key not found")
}

func (akm *APIKeyManager) UpdateAPIKey(apiKeyID, userID string, updates map[string]interface{}) error {
	akm.mu.Lock()
	defer akm.mu.Unlock()

	for keyStr, key := range akm.apiKeys {
		if key.ID == apiKeyID && key.UserID == userID {
			if name, ok := updates["name"].(string); ok {
				key.Name = name
			}
			if permissions, ok := updates["permissions"].([]string); ok {
				key.Permissions = permissions
			}
			if ipWhitelist, ok := updates["ip_whitelist"].([]string); ok {
				key.IPWhitelist = ipWhitelist
			}
			if rateLimit, ok := updates["rate_limit"].(int); ok {
				key.RateLimit = rateLimit
			}
			key.UpdatedAt = time.Now()
			return nil
		}
	}

	return errors.New("API key not found")
}

func (akm *APIKeyManager) CheckRateLimit(apiKeyID string) (bool, error) {
	akm.mu.Lock()
	defer akm.mu.Unlock()

	key, exists := akm.apiKeys[apiKeyID]
	if !exists {
		return false, errors.New("API key not found")
	}

	limit := key.RateLimit
	if limit <= 0 {
		limit = 100 // Default limit
	}

	rl, exists := akm.rateLimits[apiKeyID]
	now := time.Now()

	if !exists || now.Sub(rl.LastReset).Hours() >= 1 {
		// Reset rate limit
		akm.rateLimits[apiKeyID] = &APIRateLimit{
			APIKeyID:  apiKeyID,
			Requests:  make(map[string]int64),
			LastReset: now,
		}
		rl = akm.rateLimits[apiKeyID]
	}

	// Check limit
	hourKey := now.Format("2006010215")
	count := rl.Requests[hourKey]

	if count >= int64(limit) {
		return false, errors.New("rate limit exceeded")
	}

	rl.Requests[hourKey] = count + 1

	return true, nil
}

func (akm *APIKeyManager) LogAccess(log APIAccessLog) {
	akm.mu.Lock()
	defer akm.mu.Unlock()

	akm.accessLogs = append(akm.accessLogs, log)

	// Keep only last 10000 logs
	if len(akm.accessLogs) > 10000 {
		akm.accessLogs = akm.accessLogs[-10000:]
	}
}

func (akm *APIKeyManager) GetAccessLogs(userID string, limit int) []APIAccessLog {
	akm.mu.RLock()
	defer akm.mu.RUnlock()

	var logs []APIAccessLog
	count := 0
	for i := len(akm.accessLogs) - 1; i >= 0 && count < limit; i-- {
		if akm.accessLogs[i].UserID == userID {
			logs = append(logs, akm.accessLogs[i])
			count++
		}
	}

	return logs
}

func generateSecureToken(length int) (string, error) {
	bytes := make([]byte, length)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.URLEncoding.EncodeToString(bytes), nil
}

func hashSecret(secret string) string {
	hasher := sha256.New()
	hasher.Write([]byte(secret))
	return hex.EncodeToString(hasher.Sum(nil))
}
