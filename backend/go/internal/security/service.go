// Package security provides security services
package security

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"golang.org/x/crypto/hkdf"
	"golang.org/x/crypto/pbkdf2"

	"tigerex-api/internal/api"
)

var (
	ErrInvalidKey   = errors.New("invalid key")
	ErrNotAuthorized = errors.New("not authorized")
)

// Config holds security configuration
type Config struct {
	MasterKey [32]byte
}

// ColdWallet represents a cold wallet
type ColdWallet struct {
	ID        string `json:"id"`
	Asset    string `json:"asset"`
	Address  string `json:"address"`
	Network  string `json:"network"`
	Balance  float64 `json:"balance"`
	Threshold float64 `json:"threshold"`
	Status   string `json:"status"`
}

// MultiSigTx represents a multi-signature transaction
type MultiSigTx struct {
	ID          string   `json:"id"`
	FromWallet string   `json:"fromWallet"`
	ToAddress  string   `json:"toAddress"`
	Amount    float64  `json:"amount"`
	Asset     string   `json:"asset"`
	Signers   []string `json:"signers"`
	Required  int     `json:"required"`
	SignedBy  []string `json:"signedBy"`
	Status   string   `json:"status"`
	CreatedAt int64   `json:"createdAt"`
}

// Service handles security operations
type Service struct {
	config  Config
	cipher  cipher.AEAD
}

// NewService creates a new security service
func NewService(config Config) *Service {
	block, _ := aes.NewCipher(config.MasterKey[:])
	gcm, _ := cipher.NewGCM(block)
	
	return &Service{
		config: config,
		cipher: gcm,
	}
}

// DeriveKey derives an encryption key from master key and salt
func DeriveKey(masterKey []byte, salt []byte) []byte {
	key := make([]byte, 32)
	kdf := hkdf.New(sha256.New, masterKey, salt, []byte("tigerex-encryption"))
	kdf.Read(key)
	return key
}

// HashPassword hashes a password with salt
func HashPassword(password, salt []byte) []byte {
	return pbkdf2.Key(password, salt, 100000, 32, sha256.New)
}

// GenerateSalt generates a random salt
func GenerateSalt(size int) []byte {
	salt := make([]byte, size)
	rand.Read(salt)
	return salt
}

// GenerateOTP generates a one-time password
func GenerateOTP(secret string, timestamp int64) string {
	// TOTP implementation
	// This is a simplified version - real implementation would use RFC 6238
	
	secretHash := sha256.Sum256([]byte(secret))
	totpSteps := timestamp / 30
	
	// Combine secret hash with step
	data := append(secretHash[:], []byte(fmt.Sprintf("%d", totpSteps))...)
	hash := sha256.Sum256(data)
	
	// Generate 6-digit code
	code := 0
	for i, b := range hash[:4] {
		code = code*256 + int(b)
	}
	code = code % 1000000
	
	return fmt.Sprintf("%06d", code)
}

// VerifyOTP verifies a one-time password
func VerifyOTP(secret, code string, timestamp int64, window int) bool {
	// Check current and previous windows
	for offset := 0; offset <= window; offset++ {
		expected := GenerateOTP(secret, timestamp-int64(offset*30))
		if expected == code {
			return true
		}
	}
	return false
}

// GenerateAntiPhishingCode generates an anti-phishing code
func GenerateAntiPhishingCode() string {
	bytes := make([]byte, 8)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)[:8]
}

// Encrypt encrypts sensitive data
func (s *Service) Encrypt(plaintext string) (string, error) {
	nonce := make([]byte, s.cipher.NonceSize())
	rand.Read(nonce)
	
	ciphertext := s.cipher.Seal(nonce, nonce, []byte(plaintext), nil)
	return hex.EncodeToString(ciphertext), nil
}

// Decrypt decrypts sensitive data
func (s *Service) Decrypt(ciphertextHex string) (string, error) {
	ciphertext, err := hex.DecodeString(ciphertextHex)
	if err != nil {
		return "", err
	}
	
	nonceSize := s.cipher.NonceSize()
	if len(ciphertext) < nonceSize {
		return "", ErrInvalidKey
	}
	
	nonce, ciphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]
	plaintext, err := s.cipher.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", err
	}
	
	return string(plaintext), nil
}

// CreateMultiSigWallet creates a multi-signature wallet
func (s *Service) CreateMultiSigWallet(ctx context.Context, signers []string, threshold int) (*ColdWallet, error) {
	if len(signers) < threshold || threshold < 2 {
		return nil, errors.New("invalid threshold")
	}
	
	// Generate wallet address
	// This is a placeholder - real implementation would use HD wallet
	bytes := make([]byte, 20)
	rand.Read(bytes)
	
	wallet := &ColdWallet{
		ID:        fmt.Sprintf("cold-%d", time.Now().Unix()),
		Asset:     "BTC",
		Address:  "bc1" + hex.EncodeToString(bytes)[:39],
		Network:  "Bitcoin",
		Balance:  0,
		Status:   "active",
	}
	
	return wallet, nil
}

// SignMultiSigTx signs a multi-signature transaction
func (s *Service) SignMultiSigTx(ctx context.Context, tx *MultiSigTx, signerID string) error {
	if tx == nil || signerID == "" {
		return ErrNotAuthorized
	}
	
	// Check if signer is authorized
	for _, s := range tx.Signers {
		if s == signerID {
			// Check if already signed
			for _, signed := range tx.SignedBy {
				if signed == signerID {
					return errors.New("already signed")
				}
			}
			
			tx.SignedBy = append(tx.SignedBy, signerID)
			
			// Check if threshold reached
			if len(tx.SignedBy) >= tx.Required {
				tx.Status = "approved"
			}
			
			return nil
		}
	}
	
	return ErrNotAuthorized
}

// VerifySignature verifies a transaction signature
func (s *Service) VerifySignature(tx *MultiSigTx) bool {
	if tx == nil {
		return false
	}
	
	// Check if enough signatures
	if len(tx.SignedBy) < tx.Required {
		return false
	}
	
	// Verify each signature is from an authorized signer
	signerSet := make(map[string]bool)
	for _, s := range tx.Signers {
		signerSet[s] = true
	}
	
	for _, signed := range tx.SignedBy {
		if !signerSet[signed] {
			return false
		}
	}
	
	return true
}

// CreateWithdrawalApproval creates a withdrawal approval request
func (s *Service) CreateWithdrawalApproval(ctx context.Context, withdrawal *api.Withdrawal, approvers []string) error {
	if withdrawal == nil {
		return ErrInvalidKey
	}
	
	// This is a placeholder - real implementation would:
	// 1. Create approval request
	// 2. Send to approvers
	// 3. Wait for threshold signatures
	
	return nil
}

// CheckWithdrawalApproval checks if withdrawal is approved
func (s *Service) CheckWithdrawalApproval(ctx context.Context, withdrawalID string) (bool, error) {
	if withdrawalID == "" {
		return false, ErrInvalidKey
	}
	
	// This is a placeholder - real implementation would check approval status
	return false, nil
}

// RateLimiter provides rate limiting
type RateLimiter struct {
	requests map[string][]int64
	limit    int
	window   int64
}

// NewRateLimiter creates a new rate limiter
func NewRateLimiter(limit int, windowSeconds int) *RateLimiter {
	return &RateLimiter{
		requests: make(map[string][]int64),
		limit:   limit,
		window:  int64(windowSeconds),
	}
}

// Allow checks if request is allowed
func (rl *RateLimiter) Allow(key string) bool {
	now := time.Now().Unix()
	
	// Clean old requests
	requests := rl.requests[key]
	var valid []int64
	for _, ts := range requests {
		if now-ts < rl.window {
			valid = append(valid, ts)
		}
	}
	
	// Check limit
	if len(valid) >= rl.limit {
		rl.requests[key] = valid
		return false
	}
	
	// Add new request
	valid = append(valid, now)
	rl.requests[key] = valid
	
	return true
}

// IPBlockList provides IP blocking functionality
type IPBlockList struct {
	blocked   map[string]int64
	tempBlock map[string]int64
}

// NewIPBlockList creates a new IP block list
func NewIPBlockList() *IPBlockList {
	return &IPBlockList{
		blocked:   make(map[string]int64),
		tempBlock: make(map[string]int64),
	}
}

// Block blocks an IP
func (bl *IPBlockList) Block(ip string, duration int64) {
	bl.blocked[ip] = time.Now().Unix() + duration
}

// Unblock unblocks an IP
func (bl *IPBlockList) Unblock(ip string) {
	delete(bl.blocked, ip)
	delete(bl.tempBlock, ip)
}

// IsBlocked checks if IP is blocked
func (bl *IPBlockList) IsBlocked(ip string) bool {
	// Check permanent block
	if exp, ok := bl.blocked[ip]; ok {
		if time.Now().Unix() < exp {
			return true
		}
		delete(bl.blocked, ip)
	}
	
	// Check temporary block
	if exp, ok := bl.tempBlock[ip]; ok {
		if time.Now().Unix() < exp {
			return true
		}
		delete(bl.tempBlock, ip)
	}
	
	return false
}

// TempBlock temporarily blocks an IP
func (bl *IPBlockList) TempBlock(ip string, durationSeconds int) {
	bl.tempBlock[ip] = time.Now().Unix() + int64(durationSeconds)
}

// AuditLog provides audit logging
type AuditLog struct {
	UserID    string `json:"userId"`
	Action   string `json:"action"`
	IP       string `json:"ip"`
	UserAgent string `json:"userAgent"`
	Timestamp int64  `json:"timestamp"`
	Details  string `json:"details"`
}

// LogAction logs an action for audit
func LogAction(userID, action, ip, userAgent, details string) *AuditLog {
	return &AuditLog{
		UserID:    userID,
		Action:   action,
		IP:       ip,
		UserAgent: userAgent,
		Timestamp: api.Now(),
		Details:  details,
	}
}