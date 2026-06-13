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
	"strings"
	"time"

	"github.com/google/uuid"

	"tigerex-api/internal/api"
)

var (
	ErrInsufficientBalance = errors.New("insufficient balance")
	ErrInvalidAddress  = errors.New("invalid address")
	ErrAddressNotWhitelisted = errors.New("address not whitelisted")
	ErrInvalidAmount = errors.New("invalid amount")
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

// CreateDefaultWallets creates default wallets for a user
func (s *Service) CreateDefaultWallets(ctx context.Context, userID string) error {
	if userID == "" {
		return ErrInvalidAddress
	}
	
	// Create default wallets for supported assets
	assets := []string{"BTC", "ETH", "USDT", "BNB", "SOL", "XRP", "ADA", "DOGE", "AVAX", "MATIC", "DOT"}
	
	for _, asset := range assets {
		wallet := api.Wallet{
			UserID:     userID,
			Asset:      asset,
			Network:    s.getDefaultNetwork(asset),
			Available:  0,
			Locked:    0,
			Total:     0,
		}
		
		// This is a placeholder - real implementation would store in database
		_ = wallet
	}
	
	return nil
}

// GetDefaultNetwork returns the default network for an asset
func (s *Service) getDefaultNetwork(asset string) string {
	networks := map[string]string{
		"BTC":  "Bitcoin",
		"ETH":  "Ethereum",
		"USDT": "Ethereum",
		"BNB": "BNB Smart Chain",
		"SOL": "Solana",
		"XRP": "XRP Ledger",
		"ADA": "Cardano",
		"DOGE": "Dogecoin",
		"AVAX": "Avalanche C-Chain",
		"MATIC": "Polygon",
		"DOT": "Polkadot",
	}
	
	if network, ok := networks[asset]; ok {
		return network
	}
	return "Ethereum"
}

// GetWallets retrieves wallets for a user
func (s *Service) GetWallets(ctx context.Context, userID string) ([]api.Wallet, error) {
	if userID == "" {
		return nil, ErrInvalidAddress
	}
	
	// This is a placeholder - real implementation would query database
	return []api.Wallet{}, nil
}

// GetBalance retrieves balance for an asset
func (s *Service) GetBalance(ctx context.Context, userID, asset string) (*api.Wallet, error) {
	if userID == "" || asset == "" {
		return nil, ErrInvalidAddress
	}
	
	wallet := &api.Wallet{
		UserID:     userID,
		Asset:     asset,
		Network:   s.getDefaultNetwork(asset),
		Available: 0,
		Locked:    0,
		Total:     0,
	}
	
	// This is a placeholder - real implementation would query database
	return wallet, nil
}

// GetDepositAddress retrieves a deposit address
func (s *Service) GetDepositAddress(ctx context.Context, userID, asset, network string) (*DepositAddress, error) {
	if userID == "" || asset == "" {
		return nil, ErrInvalidAddress
	}
	
	if network == "" {
		network = s.getDefaultNetwork(asset)
	}
	
	// Generate deposit address
	// This is a placeholder - real implementation would:
	// 1. Check if address exists
	// 2. Generate new address using HD wallet
	// 3. Return address with memo if required
	
	address := DepositAddress{
		Asset:   asset,
		Address: s.generateAddress(asset, network),
		Network: network,
	}
	
	// Set memo/tag for assets that require it
	if asset == "XRP" || asset == "ATOM" || asset == "EOS" {
		address.TagType = "tag"
		address.Memo = uuid.New().String()[:8]
	}
	
	return &address, nil
}

// generateAddress generates a new deposit address
func (s *Service) generateAddress(asset, network string) string {
	// This is a placeholder - real implementation would use HD wallet derivation
	// For now, generate a random address format
	
	bytes := make([]byte, 20)
	rand.Read(bytes)
	
	switch asset {
	case "BTC":
		return "bc1" + hex.EncodeToString(bytes)[:39]
	case "ETH", "USDT", "BNB", "MATIC", "AVAX":
		return "0x" + hex.EncodeToString(bytes)
	case "SOL":
		return base58Encode(bytes)
	case "XRP":
		return "r" + base58Encode(bytes)
	default:
		return hex.EncodeToString(bytes)
	}
}

// base58Encode encodes bytes in base58
func base58Encode(data []byte) string {
	// Simplified base58 encoding
	alphabet := "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
	var result []byte
	
	for _, b := range data {
		result = append(result, alphabet[int(b)%len(alphabet)])
	}
	
	return string(result)
}

// RequestWithdrawal requests a withdrawal
func (s *Service) RequestWithdrawal(ctx context.Context, req *WithdrawalRequest) (*api.Withdrawal, error) {
	if req == nil || req.UserID == "" || req.Asset == "" || req.Address == "" {
		return nil, ErrInvalidAddress
	}
	
	if req.Amount <= 0 {
		return nil, ErrInvalidAmount
	}
	
	// Check balance
	balance, err := s.GetBalance(ctx, req.UserID, req.Asset)
	if err != nil {
		return nil, err
	}
	
	// Calculate fee
	fee := s.getWithdrawalFee(req.Asset, req.Network, req.FeeLevel)
	netAmount := req.Amount - fee
	
	if balance.Available < req.Amount {
		return nil, ErrInsufficientBalance
	}
	
	// Create withdrawal
	withdrawal := &api.Withdrawal{
		ID:          uuid.New().String(),
		UserID:      req.UserID,
		Asset:       req.Asset,
		Amount:      req.Amount,
		Fee:         fee,
		NetAmount:   netAmount,
		Address:     req.Address,
		Status:      "pending",
		Timestamp:  api.Now(),
	}
	
	// This is a placeholder - real implementation would:
	// 1. Lock funds
	// 2. Create withdrawal record
	// 3. Send to approval queue
	// 4. Return withdrawal
	
	return withdrawal, nil
}

// getWithdrawalFee calculates withdrawal fee
func (s *Service) getWithdrawalFee(asset, network, feeLevel string) float64 {
	// Fee schedule by asset and network
	fees := map[string]float64{
		"BTC-Bitcoin":        0.0005,
		"BTC-Lightning":      0.0001,
		"ETH-Ethereum":      0.005,
		"USDT-Ethereum":     1.0,
		"BNB-BNB Smart Chain": 0.001,
		"SOL-Solana":        0.01,
		"XRP-XRP Ledger":     0.0001,
		"ADA-Cardano":       0.2,
		"DOGE-Dogecoin":     1.0,
		"AVAX-Avalanche C-Chain": 0.01,
		"MATIC-Polygon":     0.1,
		"DOT-Polkadot":      0.1,
	}
	
	key := asset + "-" + network
	if fee, ok := fees[key]; ok {
		return fee
	}
	
	// Default fee
	return 0.01
}

// CheckWithdrawalWhitelist checks if address is whitelisted
func (s *Service) CheckWithdrawalWhitelist(ctx context.Context, userID, address string) error {
	if userID == "" || address == "" {
		return nil // Skip if user has no whitelist enabled
	}
	
	// This is a placeholder - real implementation would check database
	return nil
}

// InternalTransfer performs an internal transfer
func (s *Service) InternalTransfer(ctx context.Context, req *TransferRequest) (*api.Transfer, error) {
	if req == nil || req.FromUserID == "" || req.ToUserID == "" || req.Asset == "" {
		return nil, ErrInvalidAddress
	}
	
	if req.Amount <= 0 {
		return nil, ErrInvalidAmount
	}
	
	// Check sender balance
	balance, err := s.GetBalance(ctx, req.FromUserID, req.Asset)
	if err != nil {
		return nil, err
	}
	
	if balance.Available < req.Amount {
		return nil, ErrInsufficientBalance
	}
	
	// Create transfer
	transfer := &api.Transfer{
		ID:        uuid.New().String(),
		FromUserID: req.FromUserID,
		ToUserID:  req.ToUserID,
		Asset:    req.Asset,
		Amount:   req.Amount,
		Memo:     req.Memo,
		Status:   "completed",
		Timestamp: api.Now(),
	}
	
	// This is a placeholder - real implementation would:
	// 1. Lock sender funds
	// 2. Create transfer record
	// 3. Credit recipient
	// 4. Complete transfer
	
	return transfer, nil
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