// Package wallet provides wallet and transfer services
package wallet

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"strings"

	"tigerex/backend/internal/api"
)

var (
	ErrInsufficientBalance = errors.New("insufficient balance")
	ErrInvalidAddress  = errors.New("invalid address")
	ErrAddressNotWhitelisted = errors.New("address not whitelisted")
	ErrInvalidAmount = errors.New("invalid amount")
	// ErrCustodyUnavailable indicates that durable ledger/custody dependencies are not configured.
	// Wallet operations must fail closed rather than fabricate balances, addresses, or transfers.
	ErrCustodyUnavailable = errors.New("wallet custody is not configured")
)

// Config holds wallet configuration
type Config struct {
	MasterKey [32]byte
}

// DepositAddress represents a deposit address
type DepositAddress struct {
	Asset    string `json:"asset"`
	Address  string `json:"address"`
	Memo     string `json:"memo,omitempty"`
	Network  string `json:"network"`
	TagType  string `json:"tagType,omitempty"`
}

// WithdrawalRequest represents a withdrawal request
type WithdrawalRequest struct {
	UserID   string
	Asset   string
	Amount  float64
	Address string
	Memo    string
	Network string
	FeeLevel string
}

// TransferRequest represents a transfer request
type TransferRequest struct {
	FromUserID string
	ToUserID  string
	Asset    string
	Amount   float64
	Memo     string
}

// Service handles wallet operations
type Service struct {
	config    Config
	cipher   cipher.AEAD
}

// NewService creates a new wallet service
func NewService(config Config) *Service {
	// Create AES-GCM cipher for encrypting sensitive data
	block, _ := aes.NewCipher(config.MasterKey[:])
	gcm, _ := cipher.NewGCM(block)
	
	return &Service{
		config:  config,
		cipher:  gcm,
	}
}

// CreateDefaultWallets refuses to report success until durable wallet persistence exists.
func (s *Service) CreateDefaultWallets(ctx context.Context, userID string) error {
	if userID == "" {
		return ErrInvalidAddress
	}
	return ErrCustodyUnavailable
}

// GetWallets retrieves wallets only from a configured durable wallet store.
func (s *Service) GetWallets(ctx context.Context, userID string) ([]api.Wallet, error) {
	if userID == "" {
		return nil, ErrInvalidAddress
	}
	return nil, ErrCustodyUnavailable
}

// GetBalance retrieves a balance only from the authoritative ledger.
func (s *Service) GetBalance(ctx context.Context, userID, asset string) (*api.Wallet, error) {
	if userID == "" || asset == "" {
		return nil, ErrInvalidAddress
	}
	return nil, ErrCustodyUnavailable
}

// GetDepositAddress returns an error until chain-specific HD derivation and durable
// address assignment are configured. Random address-shaped strings are unsafe.
func (s *Service) GetDepositAddress(ctx context.Context, userID, asset, network string) (*DepositAddress, error) {
	if userID == "" || asset == "" {
		return nil, ErrInvalidAddress
	}
	return nil, ErrCustodyUnavailable
}

// RequestWithdrawal must be implemented atomically against the ledger, policy engine,
// approval workflow, and chain signer. Do not return a pending withdrawal without those
// durable side effects.
func (s *Service) RequestWithdrawal(ctx context.Context, req *WithdrawalRequest) (*api.Withdrawal, error) {
	if req == nil || req.UserID == "" || req.Asset == "" || req.Address == "" {
		return nil, ErrInvalidAddress
	}
	if req.Amount <= 0 {
		return nil, ErrInvalidAmount
	}
	return nil, ErrCustodyUnavailable
}

// CheckWithdrawalWhitelist fails closed until the persistent policy store is configured.
func (s *Service) CheckWithdrawalWhitelist(ctx context.Context, userID, address string) error {
	if userID == "" || address == "" {
		return ErrInvalidAddress
	}
	return ErrCustodyUnavailable
}

// InternalTransfer must be an atomic double-entry ledger transaction. Until that
// durable ledger is connected, returning "completed" would misrepresent fund movement.
func (s *Service) InternalTransfer(ctx context.Context, req *TransferRequest) (*api.Transfer, error) {
	if req == nil || req.FromUserID == "" || req.ToUserID == "" || req.Asset == "" {
		return nil, ErrInvalidAddress
	}
	if req.FromUserID == req.ToUserID {
		return nil, ErrInvalidAddress
	}
	if req.Amount <= 0 {
		return nil, ErrInvalidAmount
	}
	return nil, ErrCustodyUnavailable
}

// Encrypt encrypts sensitive data
func (s *Service) Encrypt(plaintext string) (string, error) {
	if s == nil || s.cipher == nil {
		return "", ErrCustodyUnavailable
	}
	nonce := make([]byte, s.cipher.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("generate encryption nonce: %w", err)
	}
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
		return "", errors.New("ciphertext too short")
	}
	
	nonce, ciphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]
	plaintext, err := s.cipher.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", err
	}
	
	return string(plaintext), nil
}

// ValidateAddress validates a blockchain address
func (s *Service) ValidateAddress(asset, address string) bool {
	if address == "" {
		return false
	}
	
	switch asset {
	case "BTC":
		// Valid BTC address: 1... or 3... or bc1...
		if strings.HasPrefix(address, "1") || strings.HasPrefix(address, "3") || strings.HasPrefix(address, "bc1") {
			return true
		}
	case "ETH", "USDT", "BNB", "MATIC", "AVAX":
		// Valid ETH address: 0x + 40 hex characters
		if strings.HasPrefix(address, "0x") && len(address) == 42 {
			_, err := hex.DecodeString(address[2:])
			return err == nil
		}
	}
	
	return false
}

// Transfer represents an internal transfer (for API compatibility)
type Transfer struct {
	ID        string  `json:"id"`
	FromUserID string `json:"fromUserId"`
	ToUserID  string `json:"toUserId"`
	Asset    string `json:"asset"`
	Amount   float64 `json:"amount"`
	Memo     string `json:"memo,omitempty"`
	Status   string `json:"status"`
	Timestamp int64 `json:"timestamp"`
}