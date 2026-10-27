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

	"tigerex/backend/internal/api"
	"tigerex/backend/internal/totp"
)

var (
	ErrInvalidKey    = errors.New("invalid key")
	ErrNotAuthorized = errors.New("not authorized")
)

// Config holds security configuration
type Config struct {
	MasterKey [32]byte
}

// ColdWallet represents a cold wallet
type ColdWallet struct {
	ID        string  `json:"id"`
	Asset     string  `json:"asset"`
	Address   string  `json:"address"`
	Network   string  `json:"network"`
	Balance   float64 `json:"balance"`
	Threshold float64 `json:"threshold"`
	Status    string  `json:"status"`
}

// MultiSigTx represents a multi-signature transaction
type MultiSigTx struct {
	ID         string   `json:"id"`
	FromWallet string   `json:"fromWallet"`
	ToAddress  string   `json:"toAddress"`
	Amount     float64  `json:"amount"`
	Asset      string   `json:"asset"`
	Signers    []string `json:"signers"`
	Required   int      `json:"required"`
	SignedBy   []string `json:"signedBy"`
	Status     string   `json:"status"`
	CreatedAt  int64    `json:"createdAt"`
}

// AddressDeriver produces a real custody address for a multisig policy. The
// deployment wires this to the HD wallet and script builder; there is no
// default because an address that does not correspond to a spendable script
// would strand any funds sent to it.
type AddressDeriver interface {
	DeriveMultisigAddress(ctx context.Context, signers []string, threshold int) (string, error)
}

// ApprovalStore persists withdrawal approval requests.
type ApprovalStore interface {
	Create(ctx context.Context, withdrawalID string, approvers []string) error
	Status(ctx context.Context, withdrawalID string) (approved bool, found bool, err error)
}

// ErrNotConfigured is returned when an operation needs a provider that the
// deployment has not wired.
var ErrNotConfigured = errors.New("required provider is not configured")

// Service handles security operations
type Service struct {
	config    Config
	cipher    cipher.AEAD
	deriver   AddressDeriver
	approvals ApprovalStore
}

// WithAddressDeriver returns the service with a custody address deriver
// attached.
func (s *Service) WithAddressDeriver(d AddressDeriver) *Service {
	s.deriver = d
	return s
}

// WithApprovalStore returns the service with a withdrawal approval store
// attached.
func (s *Service) WithApprovalStore(a ApprovalStore) *Service {
	s.approvals = a
	return s
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
func GenerateSalt(size int) ([]byte, error) {
	if size <= 0 {
		return nil, errors.New("salt size must be positive")
	}
	salt := make([]byte, size)
	if _, err := rand.Read(salt); err != nil {
		return nil, fmt.Errorf("generating salt: %w", err)
	}
	return salt, nil
}

// GenerateOTP returns the TOTP code for a base32 secret at a given time.
//
// The previous implementation hashed the secret with SHA-256 and the time step
// and took the first four bytes. That is not the RFC 4226 truncation, so the
// codes did not match any authenticator app. It now delegates to the shared
// RFC 6238 implementation.
func GenerateOTP(secret string, timestamp int64) string {
	key, err := totp.DecodeSecret(secret)
	if err != nil {
		return ""
	}
	code, err := totp.Generate(totp.Config{Secret: key}, time.Unix(timestamp, 0))
	if err != nil {
		return ""
	}
	return code
}

// VerifyOTP checks a TOTP code against the secret, allowing the given number of
// periods of clock drift.
func VerifyOTP(secret, code string, timestamp int64, window int) bool {
	key, err := totp.DecodeSecret(secret)
	if err != nil {
		return false
	}
	if window < 0 {
		window = 0
	}
	return totp.ValidateWithSkew(totp.Config{Secret: key}, code, time.Unix(timestamp, 0), window)
}

// GenerateAntiPhishingCode generates an anti-phishing code
func GenerateAntiPhishingCode() (string, error) {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generating anti-phishing code: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// Encrypt encrypts sensitive data
func (s *Service) Encrypt(plaintext string) (string, error) {
	if s.cipher == nil {
		return "", ErrInvalidKey
	}
	nonce := make([]byte, s.cipher.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", fmt.Errorf("generating nonce: %w", err)
	}

	ciphertext := s.cipher.Seal(nonce, nonce, []byte(plaintext), nil)
	return hex.EncodeToString(ciphertext), nil
}

// Decrypt decrypts sensitive data
func (s *Service) Decrypt(ciphertextHex string) (string, error) {
	if s.cipher == nil {
		return "", ErrInvalidKey
	}
	ciphertext, err := hex.DecodeString(ciphertextHex)
	if err != nil {
		return "", ErrInvalidKey
	}

	nonceSize := s.cipher.NonceSize()
	if len(ciphertext) < nonceSize {
		return "", ErrInvalidKey
	}

	nonce, body := ciphertext[:nonceSize], ciphertext[nonceSize:]
	plaintext, err := s.cipher.Open(nil, nonce, body, nil)
	if err != nil {
		return "", ErrInvalidKey
	}

	return string(plaintext), nil
}

// CreateMultiSigWallet creates a multi-signature wallet
func (s *Service) CreateMultiSigWallet(ctx context.Context, signers []string, threshold int) (*ColdWallet, error) {
	if len(signers) < threshold || threshold < 2 {
		return nil, errors.New("invalid threshold")
	}

	// The address must be derived from the signer set and threshold. The
	// previous version built "bc1" plus 39 hex characters from random bytes,
	// which is not a valid bech32 address: any deposit to it would have been
	// unrecoverable.
	if s.deriver == nil {
		return nil, ErrNotConfigured
	}
	address, err := s.deriver.DeriveMultisigAddress(ctx, signers, threshold)
	if err != nil {
		return nil, err
	}

	wallet := &ColdWallet{
		ID:      fmt.Sprintf("cold-%d", time.Now().Unix()),
		Asset:   "BTC",
		Address: address,
		Network: "Bitcoin",
		Balance: 0,
		Status:  "active",
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
	if len(approvers) == 0 {
		return errors.New("at least one approver is required")
	}
	if s.approvals == nil {
		return ErrNotConfigured
	}
	return s.approvals.Create(ctx, withdrawal.ID, approvers)
}

// CheckWithdrawalApproval checks if withdrawal is approved
func (s *Service) CheckWithdrawalApproval(ctx context.Context, withdrawalID string) (bool, error) {
	if withdrawalID == "" {
		return false, ErrInvalidKey
	}
	if s.approvals == nil {
		return false, ErrNotConfigured
	}
	approved, found, err := s.approvals.Status(ctx, withdrawalID)
	if err != nil {
		return false, err
	}
	if !found {
		return false, ErrInvalidKey
	}
	return approved, nil
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
		limit:    limit,
		window:   int64(windowSeconds),
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
	Action    string `json:"action"`
	IP        string `json:"ip"`
	UserAgent string `json:"userAgent"`
	Timestamp int64  `json:"timestamp"`
	Details   string `json:"details"`
}

// LogAction logs an action for audit
func LogAction(userID, action, ip, userAgent, details string) *AuditLog {
	return &AuditLog{
		UserID:    userID,
		Action:    action,
		IP:        ip,
		UserAgent: userAgent,
		Timestamp: api.Now(),
		Details:   details,
	}
}
