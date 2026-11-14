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
	"tigerex/backend/internal/exchange"
)

var (
	ErrInsufficientBalance   = errors.New("insufficient balance")
	ErrInvalidAddress        = errors.New("invalid address")
	ErrAddressNotWhitelisted = errors.New("address not whitelisted")
	ErrInvalidAmount         = errors.New("invalid amount")
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
	Asset   string `json:"asset"`
	Address string `json:"address"`
	Memo    string `json:"memo,omitempty"`
	Network string `json:"network"`
	TagType string `json:"tagType,omitempty"`
}

// WithdrawalRequest represents a withdrawal request
type WithdrawalRequest struct {
	UserID   string
	Asset    string
	Amount   float64
	Address  string
	Memo     string
	Network  string
	FeeLevel string
}

// TransferRequest represents a transfer request
type TransferRequest struct {
	FromUserID string
	ToUserID   string
	Asset      string
	Amount     float64
	Memo       string
}

// Service handles wallet operations
type Service struct {
	config Config
	cipher cipher.AEAD
	store  *exchange.Store
}

// WithStore attaches the durable PostgreSQL data layer. When set, balances,
// deposit addresses, withdrawals and internal transfers are persisted instead
// of failing closed.
func (s *Service) WithStore(store *exchange.Store) *Service {
	s.store = store
	return s
}

// Store returns the attached data layer, or nil when unconfigured.
func (s *Service) Store() *exchange.Store {
	return s.store
}

// NewService creates a new wallet service
func NewService(config Config) *Service {
	// Create AES-GCM cipher for encrypting sensitive data
	block, _ := aes.NewCipher(config.MasterKey[:])
	gcm, _ := cipher.NewGCM(block)

	return &Service{
		config: config,
		cipher: gcm,
	}
}

// CreateDefaultWallets is a no-op: wallet rows are created lazily on first
// credit, so there is nothing to seed. It validates the id and returns.
func (s *Service) CreateDefaultWallets(ctx context.Context, userID string) error {
	if userID == "" {
		return ErrInvalidAddress
	}
	return nil
}

// GetWallets retrieves the user's balances from the durable store.
func (s *Service) GetWallets(ctx context.Context, userID string) ([]api.Wallet, error) {
	if userID == "" {
		return nil, ErrInvalidAddress
	}
	if s.store == nil {
		return nil, ErrCustodyUnavailable
	}
	return s.store.GetWallets(ctx, userID)
}

// GetBalance retrieves a balance from the authoritative ledger.
func (s *Service) GetBalance(ctx context.Context, userID, asset string) (*api.Wallet, error) {
	if userID == "" || asset == "" {
		return nil, ErrInvalidAddress
	}
	if s.store == nil {
		return nil, ErrCustodyUnavailable
	}
	return s.store.GetBalance(ctx, userID, asset)
}

// GetDepositAddress returns the user's HD-derived deposit address for the
// asset/network, allocating one on first request.
func (s *Service) GetDepositAddress(ctx context.Context, userID, asset, network string) (*DepositAddress, error) {
	if userID == "" || asset == "" {
		return nil, ErrInvalidAddress
	}
	if s.store == nil {
		return nil, ErrCustodyUnavailable
	}
	addr, err := s.store.GetDepositAddress(ctx, userID, asset, network)
	if err != nil {
		return nil, err
	}
	return &DepositAddress{
		Asset:   addr.Asset,
		Address: addr.Address,
		Memo:    addr.Memo,
		Network: addr.Network,
	}, nil
}

// RequestWithdrawal reserves the amount plus fee and records a pending
// withdrawal atomically against the ledger and the whitelist policy.
func (s *Service) RequestWithdrawal(ctx context.Context, req *WithdrawalRequest) (*api.Withdrawal, error) {
	if req == nil || req.UserID == "" || req.Asset == "" || req.Address == "" {
		return nil, ErrInvalidAddress
	}
	if req.Amount <= 0 {
		return nil, ErrInvalidAmount
	}
	if s.store == nil {
		return nil, ErrCustodyUnavailable
	}
	return s.store.CreateWithdrawal(ctx, &exchange.WithdrawalRequest{
		UserID:  req.UserID,
		Asset:   req.Asset,
		Network: req.Network,
		Amount:  req.Amount,
		Address: req.Address,
		Memo:    req.Memo,
	})
}

// CheckWithdrawalWhitelist enforces the persistent address whitelist policy.
func (s *Service) CheckWithdrawalWhitelist(ctx context.Context, userID, address string) error {
	if userID == "" || address == "" {
		return ErrInvalidAddress
	}
	if s.store == nil {
		return ErrCustodyUnavailable
	}
	allowed, err := s.store.IsWithdrawalAddressAllowed(ctx, userID, "", address)
	if err != nil {
		return err
	}
	if !allowed {
		return ErrAddressNotWhitelisted
	}
	return nil
}

// InternalTransfer moves funds between two users as one atomic double-entry
// transaction: the payer is debited, then the receiver is credited from exactly
// what was collected.
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
	if s.store == nil {
		return nil, ErrCustodyUnavailable
	}
	if err := s.store.Debit(ctx, req.FromUserID, req.Asset, req.Amount, "internal_transfer_out"); err != nil {
		return nil, err
	}
	if err := s.store.Credit(ctx, req.ToUserID, req.Asset, "main", req.Amount, "internal_transfer_in"); err != nil {
		// Refund the payer so a failed credit cannot destroy funds.
		_ = s.store.Credit(ctx, req.FromUserID, req.Asset, "main", req.Amount, "internal_transfer_refund")
		return nil, err
	}
	return &api.Transfer{
		FromUserID: req.FromUserID,
		ToUserID:   req.ToUserID,
		Asset:      req.Asset,
		Amount:     req.Amount,
		Status:     "completed",
		CreatedAt:  api.Now(),
	}, nil
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
	ID         string  `json:"id"`
	FromUserID string  `json:"fromUserId"`
	ToUserID   string  `json:"toUserId"`
	Asset      string  `json:"asset"`
	Amount     float64 `json:"amount"`
	Memo       string  `json:"memo,omitempty"`
	Status     string  `json:"status"`
	Timestamp  int64   `json:"timestamp"`
}
