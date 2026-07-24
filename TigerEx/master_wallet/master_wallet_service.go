// =============================================================================
// TIGEREX MASTER WALLET SERVICE - Go Implementation
// High-performance, distributed master wallet service
// Manages all user wallets, fees, and auto-signing operations
// =============================================================================

package main

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/big"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
)

// =============================================================================
// MASTER WALLET STRUCTURES
// =============================================================================

type MasterWallet struct {
	ID               string              `json:"id"`
	Mnemonic         string              `json:"mnemonic,omitempty"` // Encrypted
	MnemonicHash     string              `json:"mnemonicHash"`
	Addresses        map[string]string  `json:"addresses"` // blockchain -> address
	FeeSettings      FeeSettings         `json:"feeSettings"`
	SupportedChains  []string           `json:"supportedChains"`
	SupportedTokens  []string           `json:"supportedTokens"`
	CreatedAt        int64               `json:"createdAt"`
	UpdatedAt        int64               `json:"updatedAt"`
	AdminPublicKey   string              `json:"adminPublicKey"`
	BackupCodes      []string            `json:"backupCodes,omitempty"` // Encrypted
	Encrypted        bool                `json:"encrypted"`
}

type FeeSettings struct {
	WithdrawalFeePercent float64            `json:"withdrawalFeePercent"`
	SwapFeePercent      float64            `json:"swapFeePercent"`
	TransferFeePercent  float64            `json:"transferFeePercent"`
	MinWithdrawalFee    float64            `json:"minWithdrawalFee"`
	NetworkFees         map[string]float64 `json:"networkFees"` // blockchain -> fee
}

type MasterWalletStats struct {
	TotalUserWallets    int64   `json:"totalUserWallets"`
	TotalTransactions   int64   `json:"totalTransactions"`
	TotalVolume         float64 `json:"totalVolume"`
	TotalFeesCollected  float64 `json:"totalFeesCollected"`
	ActiveUsers         int64   `json:"activeUsers"`
}

type PendingTransaction struct {
	ID             string    `json:"id"`
	UserID         string    `json:"userId"`
	ToAddress      string    `json:"toAddress"`
	Amount         float64   `json:"amount"`
	Symbol         string    `json:"symbol"`
	Blockchain     string    `json:"blockchain"`
	Fee            float64   `json:"fee"`
	Status         string    `json:"status"` // pending, signing, broadcasting, confirmed, failed
	CreatedAt      int64     `json:"createdAt"`
	ProcessedAt    int64     `json:"processedAt"`
	TxHash         string    `json:"txHash,omitempty"`
	GasUsed        uint64    `json:"gasUsed,omitempty"`
	ErrorMessage   string    `json:"errorMessage,omitempty"`
}

// =============================================================================
// MASTER WALLET SERVICE
// =============================================================================

type MasterWalletService struct {
	mu            sync.RWMutex
	masterWallet  *MasterWallet
	userWallets   map[string]*UserWalletRef // userID -> reference
	transactions  map[string]*MasterTransaction
	pendingTxs    map[string]*PendingTransaction
	
	// Fee tracking
	feeCollected  map[string]float64 // symbol -> amount
	totalVolume   float64
	
	// Configuration
	config MasterWalletConfig
	
	// Statistics
	stats MasterWalletStats
	
	// Encryption
	encryptionKey []byte
	
	// Channel for auto-signing
	signChan chan *PendingTransaction
	
	ctx    context.Context
	cancel context.CancelFunc
}

type UserWalletRef struct {
	UserID      string   `json:"userId"`
	WalletID    string   `json:"walletId"`
	Blockchain  string   `json:"blockchain"`
	Address     string   `json:"address"`
	CreatedAt   int64    `json:"createdAt"`
}

type MasterTransaction struct {
	ID            string    `json:"id"`
	UserID        string    `json:"userId"`
	Type          string    `json:"type"` // withdrawal, transfer, swap
	FromAddress   string    `json:"fromAddress"`
	ToAddress     string    `json:"toAddress"`
	Amount        float64   `json:"amount"`
	Symbol        string    `json:"symbol"`
	Blockchain    string    `json:"blockchain"`
	Fee           float64   `json:"fee"`
	NetAmount     float64   `json:"netAmount"`
	Status        string    `json:"status"`
	TxHash        string    `json:"txHash"`
	CreatedAt     int64     `json:"createdAt"`
	ConfirmedAt   int64     `json:"confirmedAt"`
}

type MasterWalletConfig struct {
	AutoSignEnabled        bool
	AutoSignMaxAmount     float64
	AutoSignMaxPerHour    int
	SignTimeoutSeconds    int
	EnableWhitelist       bool
	WhitelistedAddresses []string
	EnableBlacklist       bool
	BlacklistedAddresses []string
	GasPriceMultiplier    float64
	EnableMultiSig        bool
	RequiredSignatures    int
}

func NewMasterWalletService(mnemonic string, encryptionKey []byte) (*MasterWalletService, error) {
	ctx, cancel := context.WithCancel(context.Background())

	// Generate addresses for all blockchains
	addresses := generateMasterAddresses(mnemonic)

	// Generate backup codes
	backupCodes := generateBackupCodes()

	// Generate admin public key
	adminPublicKey := generateAdminPublicKey(mnemonic)

	masterWallet := &MasterWallet{
		ID:              uuid.New().String(),
		Mnemonic:        mnemonic,
		MnemonicHash:    hashString(mnemonic),
		Addresses:       addresses,
		FeeSettings:     getDefaultFeeSettings(),
		SupportedChains:  getDefaultSupportedChains(),
		SupportedTokens:  getDefaultSupportedTokens(),
		CreatedAt:       time.Now().UnixMilli(),
		UpdatedAt:       time.Now().UnixMilli(),
		AdminPublicKey:  adminPublicKey,
		BackupCodes:     backupCodes,
		Encrypted:       false,
	}

	config := MasterWalletConfig{
		AutoSignEnabled:     true,
		AutoSignMaxAmount:   100000, // Max auto-sign without approval
		AutoSignMaxPerHour:  100,
		SignTimeoutSeconds:  3, // Must sign within 3 seconds
		EnableWhitelist:    false,
		WhitelistedAddresses: []string{},
		EnableBlacklist:    false,
		BlacklistedAddresses: []string{},
		GasPriceMultiplier:  1.1,
		EnableMultiSig:      false,
		RequiredSignatures:   1,
	}

	service := &MasterWalletService{
		masterWallet:   masterWallet,
		userWallets:     make(map[string]*UserWalletRef),
		transactions:    make(map[string]*MasterTransaction),
		pendingTxs:      make(map[string]*PendingTransaction),
		feeCollected:    make(map[string]float64),
		config:          config,
		stats:           MasterWalletStats{},
		encryptionKey:   encryptionKey,
		signChan:        make(chan *PendingTransaction, 1000),
		ctx:             ctx,
		cancel:          cancel,
	}

	// Start auto-signing worker
	go service.autoSignWorker()

	log.Printf("[INFO] Master wallet service initialized with %d chains", len(addresses))

	return service, nil
}

// =============================================================================
// USER WALLET REGISTRATION
// =============================================================================

func (s *MasterWalletService) RegisterUserWallet(userID, blockchain, address string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	ref := &UserWalletRef{
		WalletID:   uuid.New().String(),
		UserID:     userID,
		Blockchain: blockchain,
		Address:    address,
		CreatedAt:  time.Now().UnixMilli(),
	}

	s.userWallets[userID] = ref
	atomic.AddInt64(&s.stats.TotalUserWallets, 1)

	log.Printf("[INFO] User wallet registered: %s on %s", userID, blockchain)

	return nil
}

func (s *MasterWalletService) GetUserWallet(userID string) (*UserWalletRef, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	ref, ok := s.userWallets[userID]
	if !ok {
		return nil, errors.New("user wallet not found")
	}

	return ref, nil
}

func (s *MasterWalletService) GetAllUserWallets() []*UserWalletRef {
	s.mu.RLock()
	defer s.mu.RUnlock()

	wallets := make([]*UserWalletRef, 0, len(s.userWallets))
	for _, ref := range s.userWallets {
		wallets = append(wallets, ref)
	}

	return wallets
}

// =============================================================================
// TRANSACTION PROCESSING
// =============================================================================

func (s *MasterWalletService) ProcessWithdrawal(userID, toAddress, blockchain, symbol string, amount float64) (*MasterTransaction, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Validate
	if !s.config.AutoSignEnabled {
		return nil, errors.New("auto-sign disabled")
	}

	// Check blacklist
	if s.config.EnableBlacklist {
		for _, addr := range s.config.BlacklistedAddresses {
			if toAddress == addr {
				return nil, errors.New("address blacklisted")
			}
		}
	}

	// Calculate fees
	fee := s.calculateWithdrawalFee(symbol, amount)
	netAmount := amount - fee

	// Check if auto-sign or requires approval
	requiresApproval := amount > s.config.AutoSignMaxAmount

	// Get user wallet
	userRef, ok := s.userWallets[userID]
	if !ok {
		return nil, errors.New("user wallet not found")
	}

	tx := &MasterTransaction{
		ID:          uuid.New().String(),
		UserID:      userID,
		Type:        "withdrawal",
		FromAddress: s.masterWallet.Addresses[blockchain],
		ToAddress:   toAddress,
		Amount:      amount,
		Symbol:      symbol,
		Blockchain:  blockchain,
		Fee:         fee,
		NetAmount:   netAmount,
		Status:      "pending",
		CreatedAt:   time.Now().UnixMilli(),
	}

	s.transactions[tx.ID] = tx

	// If requires approval, add to pending
	if requiresApproval {
		pending := &PendingTransaction{
			ID:         tx.ID,
			UserID:     userID,
			ToAddress:  toAddress,
			Amount:     netAmount,
			Symbol:     symbol,
			Blockchain: blockchain,
			Fee:        fee,
			Status:     "pending",
			CreatedAt:  time.Now().UnixMilli(),
		}
		s.pendingTxs[tx.ID] = pending
		log.Printf("[INFO] Withdrawal requires approval: %s %f %s", userID, amount, symbol)
	} else {
		// Auto-sign immediately
		go s.autoSignWithdrawal(tx)
	}

	// Track fee
	s.feeCollected[symbol] += fee

	log.Printf("[INFO] Withdrawal processed: %s %f %s (fee: %f)", userID, amount, symbol, fee)

	return tx, nil
}

func (s *MasterWalletService) ProcessTransfer(fromUserID, toUserID, blockchain, symbol string, amount float64) (*MasterTransaction, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Get wallets
	fromRef, ok := s.userWallets[fromUserID]
	if !ok {
		return nil, errors.New("sender wallet not found")
	}

	toRef, ok := s.userWallets[toUserID]
	if !ok {
		return nil, errors.New("receiver wallet not found")
	}

	// Calculate fee
	fee := s.calculateTransferFee(symbol, amount)
	netAmount := amount - fee

	tx := &MasterTransaction{
		ID:          uuid.New().String(),
		UserID:      fromUserID,
		Type:        "transfer",
		FromAddress: fromRef.Address,
		ToAddress:   toRef.Address,
		Amount:      amount,
		Symbol:      symbol,
		Blockchain:  blockchain,
		Fee:         fee,
		NetAmount:   netAmount,
		Status:      "completed", // Internal transfer, no blockchain needed
		CreatedAt:   time.Now().UnixMilli(),
		ConfirmedAt: time.Now().UnixMilli(),
	}

	s.transactions[tx.ID] = tx
	s.feeCollected[symbol] += fee
	atomic.AddInt64(&s.stats.TotalTransactions, 1)
	s.stats.TotalVolume += amount

	log.Printf("[INFO] Transfer: %s -> %s: %f %s (fee: %f)", fromUserID, toUserID, amount, symbol, fee)

	return tx, nil
}

func (s *MasterWalletService) ProcessSwap(userID, fromSymbol, toSymbol, blockchain string, fromAmount, expectedOutput float64) (*MasterTransaction, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	tx := &MasterTransaction{
		ID:          uuid.New().String(),
		UserID:      userID,
		Type:        "swap",
		FromAddress: "",
		ToAddress:   "",
		Amount:      fromAmount,
		Symbol:      fromSymbol,
		Blockchain:  blockchain,
		Fee:         s.calculateSwapFee(fromSymbol, fromAmount),
		NetAmount:   expectedOutput,
		Status:      "pending",
		CreatedAt:   time.Now().UnixMilli(),
	}

	s.transactions[tx.ID] = tx
	atomic.AddInt64(&s.stats.TotalTransactions, 1)

	log.Printf("[INFO] Swap: %s %f %s -> %f %s", userID, fromAmount, fromSymbol, expectedOutput, toSymbol)

	return tx, nil
}

// =============================================================================
// AUTO-SIGNING
// =============================================================================

func (s *MasterWalletService) autoSignWorker() {
	for {
		select {
		case <-s.ctx.Done():
			return
		case tx := <-s.signChan:
			s.signAndBroadcast(tx)
		}
	}
}

func (s *MasterWalletService) autoSignWithdrawal(tx *MasterTransaction) {
	// Sign within 3 seconds as required
	signChan := make(chan bool, 1)
	
	go func() {
		// Auto-sign transaction
		txHash := s.signTransaction(tx)
		tx.TxHash = txHash
		tx.Status = "confirmed"
		tx.ConfirmedAt = time.Now().UnixMilli()
		signChan <- true
	}()

	// Wait for signature with timeout
	select {
	case <-signChan:
		log.Printf("[INFO] Auto-signed withdrawal: %s tx: %s", tx.ID, tx.TxHash)
	case <-time.After(time.Duration(s.config.SignTimeoutSeconds) * time.Second):
		tx.Status = "failed"
		tx.ErrorMessage = "Auto-sign timeout"
		log.Printf("[ERROR] Auto-sign timeout for: %s", tx.ID)
	}
}

func (s *MasterWalletService) signAndBroadcast(pending *PendingTransaction) {
	// Sign transaction with master wallet private key
	// In production, this would use actual blockchain signing
	
	txHash := generateTxHash(pending.UserID, pending.ToAddress, pending.Amount, pending.Symbol)
	
	s.mu.Lock()
	defer s.mu.Unlock()

	if tx, ok := s.transactions[pending.ID]; ok {
		tx.TxHash = txHash
		tx.Status = "confirmed"
		tx.ConfirmedAt = time.Now().UnixMilli()
	}

	pending.TxHash = txHash
	pending.Status = "confirmed"
	pending.ProcessedAt = time.Now().UnixMilli()

	log.Printf("[INFO] Signed and broadcast: %s tx: %s", pending.ID, txHash)
}

func (s *MasterWalletService) signTransaction(tx *MasterTransaction) string {
	// Simplified - would use actual cryptographic signing
	return generateTxHash(tx.UserID, tx.ToAddress, tx.Amount, tx.Symbol)
}

// =============================================================================
// FEE MANAGEMENT
// =============================================================================

func (s *MasterWalletService) calculateWithdrawalFee(symbol string, amount float64) float64 {
	networkFee := s.masterWallet.FeeSettings.NetworkFees[symbol]
	if networkFee == 0 {
		networkFee = 0.001 // Default
	}

	fee := amount*s.masterWallet.FeeSettings.WithdrawalFeePercent/100 + networkFee
	
	if fee < s.masterWallet.FeeSettings.MinWithdrawalFee {
		fee = s.masterWallet.FeeSettings.MinWithdrawalFee
	}

	return fee
}

func (s *MasterWalletService) calculateTransferFee(symbol string, amount float64) float64 {
	return amount * s.masterWallet.FeeSettings.TransferFeePercent / 100
}

func (s *MasterWalletService) calculateSwapFee(symbol string, amount float64) float64 {
	return amount * s.masterWallet.FeeSettings.SwapFeePercent / 100
}

func (s *MasterWalletService) UpdateFeeSettings(fees FeeSettings) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.masterWallet.FeeSettings = fees
	s.masterWallet.UpdatedAt = time.Now().UnixMilli()

	log.Printf("[INFO] Fee settings updated")

	return nil
}

func (s *MasterWalletService) GetFeeSettings() FeeSettings {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.masterWallet.FeeSettings
}

func (s *MasterWalletService) GetFeeCollection() map[string]float64 {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make(map[string]float64)
	for k, v := range s.feeCollected {
		result[k] = v
	}

	return result
}

// =============================================================================
// BLOCKCHAIN MANAGEMENT
// =============================================================================

func (s *MasterWalletService) AddBlockchainSupport(blockchain string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Check if already supported
	for _, chain := range s.masterWallet.SupportedChains {
		if chain == blockchain {
			return errors.New("blockchain already supported")
		}
	}

	s.masterWallet.SupportedChains = append(s.masterWallet.SupportedChains, blockchain)
	s.masterWallet.UpdatedAt = time.Now().UnixMilli()

	log.Printf("[INFO] Added blockchain support: %s", blockchain)

	return nil
}

func (s *MasterWalletService) RemoveBlockchainSupport(blockchain string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	newChains := []string{}
	for _, chain := range s.masterWallet.SupportedChains {
		if chain != blockchain {
			newChains = append(newChains, chain)
		}
	}

	s.masterWallet.SupportedChains = newChains
	s.masterWallet.UpdatedAt = time.Now().UnixMilli()

	log.Printf("[INFO] Removed blockchain support: %s", blockchain)

	return nil
}

// =============================================================================
// TOKEN MANAGEMENT
// =============================================================================

func (s *MasterWalletService) AddTokenSupport(token string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for _, t := range s.masterWallet.SupportedTokens {
		if t == token {
			return errors.New("token already supported")
		}
	}

	s.masterWallet.SupportedTokens = append(s.masterWallet.SupportedTokens, token)
	s.masterWallet.UpdatedAt = time.Now().UnixMilli()

	log.Printf("[INFO] Added token support: %s", token)

	return nil
}

func (s *MasterWalletService) RemoveTokenSupport(token string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	newTokens := []string{}
	for _, t := range s.masterWallet.SupportedTokens {
		if t != token {
			newTokens = append(newTokens, t)
		}
	}

	s.masterWallet.SupportedTokens = newTokens
	s.masterWallet.UpdatedAt = time.Now().UnixMilli()

	log.Printf("[INFO] Removed token support: %s", token)

	return nil
}

// =============================================================================
// TRANSACTION HISTORY
// =============================================================================

func (s *MasterWalletService) GetTransaction(txID string) (*MasterTransaction, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	tx, ok := s.transactions[txID]
	if !ok {
		return nil, errors.New("transaction not found")
	}

	return tx, nil
}

func (s *MasterWalletService) GetUserTransactions(userID string, limit int) []*MasterTransaction {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var txs []*MasterTransaction
	count := 0

	for _, tx := range s.transactions {
		if tx.UserID == userID {
			txs = append(txs, tx)
			count++
			if count >= limit {
				break
			}
		}
	}

	return txs
}

func (s *MasterWalletService) GetAllTransactions(limit int) []*MasterTransaction {
	s.mu.RLock()
	defer s.mu.RUnlock()

	txs := make([]*MasterTransaction, 0, limit)
	count := 0

	for _, tx := range s.transactions {
		txs = append(txs, tx)
		count++
		if count >= limit {
			break
		}
	}

	return txs
}

// =============================================================================
// STATISTICS
// =============================================================================

func (s *MasterWalletService) GetStats() MasterWalletStats {
	s.mu.RLock()
	defer s.mu.RUnlock()

	s.stats.TotalFeesCollected = 0
	for _, fee := range s.feeCollected {
		s.stats.TotalFeesCollected += fee
	}
	s.stats.TotalVolume = s.totalVolume

	return s.stats
}

// =============================================================================
// BACKUP & RECOVERY
// =============================================================================

func (s *MasterWalletService) GetBackupCodes() ([]string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if len(s.masterWallet.BackupCodes) == 0 {
		return nil, errors.New("no backup codes available")
	}

	return s.masterWallet.BackupCodes, nil
}

func (s *MasterWalletService) VerifyBackupCode(code string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, c := range s.masterWallet.BackupCodes {
		if c == code {
			return true
		}
	}

	return false
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

func generateMasterAddresses(mnemonic string) map[string]string {
	addresses := make(map[string]string)

	chains := []string{"eth", "bsc", "polygon", "arbitrum", "optimism", "base", "avax", "sol", "trx", "ton", "btc", "ltc", "doge", "xrp", "ada", "dot", "near", "apt", "atom"}

	for _, chain := range chains {
		hasher := sha256.New()
		hasher.Write([]byte(mnemonic))
		hasher.Write([]byte(chain))
		hash := hasher.Sum(nil)

		switch chain {
		case "eth", "bsc", "polygon", "arbitrum", "optimism", "base":
			addresses[chain] = "0x" + hex.EncodeToString(hash[12:32])
		case "btc":
			addresses[chain] = "1" + base64.StdEncoding.EncodeToString(hash[:20])
		default:
			addresses[chain] = base64.StdEncoding.EncodeToString(hash[:32])
		}
	}

	return addresses
}

func generateBackupCodes() []string {
	codes := make([]string, 10)
	for i := 0; i < 10; i++ {
		bytes := make([]byte, 4)
		rand.Read(bytes)
		codes[i] = fmt.Sprintf("%08X", bytes)
	}
	return codes
}

func generateAdminPublicKey(mnemonic string) string {
	hasher := sha256.New()
	hasher.Write([]byte(mnemonic))
	hasher.Write([]byte("admin"))
	return hex.EncodeToString(hasher.Sum(nil))
}

func generateTxHash(userID, toAddress string, amount float64, symbol string) string {
	data := fmt.Sprintf("%s|%s|%f|%s|%d", userID, toAddress, amount, symbol, time.Now().UnixNano())
	hasher := sha256.New()
	hasher.Write([]byte(data))
	return "0x" + hex.EncodeToString(hasher.Sum(nil))[:64]
}

func getDefaultFeeSettings() FeeSettings {
	return FeeSettings{
		WithdrawalFeePercent: 0.1,
		SwapFeePercent:      0.05,
		TransferFeePercent:  0.0,
		MinWithdrawalFee:    1.0,
		NetworkFees: map[string]float64{
			"btc":   0.0001,
			"eth":   0.001,
			"bsc":   0.0005,
			"polygon": 0.001,
			"sol":   0.00025,
			"trx":   1.0,
		},
	}
}

func getDefaultSupportedChains() []string {
	return []string{
		"eth", "bsc", "polygon", "arbitrum", "optimism", "base", "avax", "fantom", "cronos",
		"sol", "trx", "ton", "apt", "near", "atom", "btc", "ltc", "doge", "xrp", "ada", "dot",
	}
}

func getDefaultSupportedTokens() []string {
	return []string{
		"BTC", "ETH", "USDT", "USDC", "BNB", "SOL", "XRP", "DOGE", "ADA", "TRX",
		"TON", "AVAX", "DOT", "MATIC", "LINK", "LTC", "BCH", "UNI", "ATOM", "XLM",
		"NEAR", "APT", "FIL", "LDO", "RUNE", "MKR", "AAVE", "GRT", "SHIB", "PEPE",
		"XMR", "ALGO", "VET", "ICP", "FTM", "SAND", "MANA", "AXS", "THETA", "XTZ",
		"EOS", "CAKE", "SNX", "CRV", "1INCH", "ENJ", "CHZ", "BAT", "PAXG", "TUSD",
		"BUSD", "DAI", "FRAX", "WBTC", "WETH", "GALA", "IMX", "GMT", "INJ", "OSMO",
		"SEI", "SUI", "TIA", "ARB", "OP", "BLUR", "RDNT", "PENDLE", "JTO", "JUP",
		"WLD", "BFC",
	}
}

func hashString(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

var _ = fmt.Errorf
var _ = json.Marshal
var _ = big.NewInt
