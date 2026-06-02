// =============================================================================
// TIGEREX v3.0 - COMPLETE WALLET & CUSTODY SERVICE
// Multi-signature, hot/warm/cold wallet architecture
// =============================================================================

package main

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/sha512"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"sync"
	"time"
)

// =============================================================================
// WALLET TYPES
// =============================================================================

type WalletType string
type TransactionStatus string
type TransactionType string

const (
	HotWallet    WalletType = "hot"
	WarmWallet   WalletType = "warm"
	ColdWallet   WalletType = "cold"
	VaultWallet  WalletType = "vault"
	OperationsWallet WalletType = "operations"

	TxPending   TransactionStatus = "pending"
	TxConfirmed TransactionStatus = "confirmed"
	TxFailed    TransactionStatus = "failed"
	TxCancelled TransactionStatus = "cancelled"

	Deposit        TransactionType = "deposit"
	Withdrawal     TransactionType = "withdrawal"
	Internal       TransactionType = "internal"
	Exchange       TransactionType = "exchange"
	ColdStorage    TransactionType = "cold_storage"
	HotStorage     TransactionType = "hot_storage"
	Reserve        TransactionType = "reserve"
	Insurance      TransactionType = "insurance"
)

// Address represents a cryptocurrency address
type Address struct {
	AddressID     string
	Address       string
	DerivationPath string
	Chain         string
	Asset         string
	Type          WalletType
	UserID        string
	IsActive      bool
	IsWhitelisted bool
	Label         string
	CreatedAt     time.Time
	UpdatedAt     time.Time
	LastActivityAt time.Time
	Balance       float64
	LabelNum      int
}

// Transaction represents a blockchain transaction
type Transaction struct {
	TxID           string
	Hash           string
	Chain          string
	Asset          string
	Type           TransactionType
	FromAddress    string
	ToAddress      string
	Amount         float64
	Fee            float64
	FeeAsset       string
	NetAmount      float64
	Confirmations  int
	RequiredConfirmations int
	Status         TransactionStatus
	Source         string
	DestTag        string
	BlockNumber    int64
	BlockHash      string
	Timestamp      time.Time
	ProcessedAt    time.Time
	Memo           string
	TxJSON         string
	RetryCount     int
	MaxRetries     int
	WalletType     WalletType
}

// Wallet represents a user's wallet
type Wallet struct {
	WalletID      string
	UserID        string
	Asset         string
	Chain         string
	Address       string
	Type          WalletType
	Balance       float64
	LockedBalance float64
	AvailableBalance float64
	PendingBalance float64
	TotalDeposits float64
	TotalWithdrawals float64
	IsActive      bool
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

// WithdrawalRequest represents a withdrawal request
type WithdrawalRequest struct {
	RequestID     string
	UserID        string
	Asset         string
	Chain         string
	Amount        float64
	Fee           float64
	NetAmount     float64
	ToAddress     string
	DestTag       string
	Memo          string
	Status        string
	KycLevel      int
	RequiresKyc   bool
	IpAddress     string
	UserAgent     string
	CreatedAt     time.Time
	ApprovedAt    time.Time
	ProcessedAt   time.Time
	RejectedAt    time.Time
	RejectReason  string
	ApprovedBy    string
	RejectedBy    string
}

// DepositRecord represents a deposit record
type DepositRecord struct {
	DepositID      string
	UserID         string
	Asset          string
	Chain          string
	Amount         float64
	TxHash         string
	FromAddress    string
	ToAddress      string
	Confirmations  int
	RequiredConfs  int
	Status         string
	IndexedAt      time.Time
	ConfirmedAt    time.Time
	MinedAt        time.Time
	ProcessedAt    time.Time
	WalletType     WalletType
	Fee             float64
}

// UserBalance represents a user's balance
type UserBalance struct {
	UserID         string
	Asset          string
	Total          float64
	Available      float64
	Locked         float64
	Pending        float64
	TotalDeposits  float64
	TotalWithdrawals float64
	UpdatedAt      time.Time
}

// ColdStorageAllocation represents cold storage allocation
type ColdStorageAllocation struct {
	AllocationID   string
	Asset          string
	Chain          string
	Amount         float64
	TargetWallet   string
	WalletType     WalletType
	TxHash         string
	Status         string
	CreatedAt      time.Time
	ExecutedAt     time.Time
	ExecutedBy     string
}

// =============================================================================
// CUSTODY SERVICE
// =============================================================================

type CustodyService struct {
	// Hot wallet (for daily operations)
	hotWallet *WalletConfig
	
	// Warm wallet (for large transactions)
	warmWallet *WalletConfig
	
	// Cold wallet (for secure storage)
	coldWallet *WalletConfig
	
	// Vault (for institutional storage)
	vaultWallet *WalletConfig
	
	// Operations wallet (for operational costs)
	operationsWallet *WalletConfig
	
	// Multi-signature configuration
	multisig *MultisigConfig
	
	// HSM integration
	hsm *HSMService
	
	// Key management
	keyManager *KeyManager
	
	// Database
	db *sql.DB
	
	// Network clients
	networkClients map[string]NetworkClient
	
	// Withdrawal approval workflow
	approvalWorkflow *ApprovalWorkflow
	
	// Transaction queue
	txQueue *TransactionQueue
	
	// Balance management
	balanceManager *BalanceManager
	
	// Security
	security *SecurityService
	
	// Events
	events *EventEmitter
	
	mu sync.RWMutex
}

type WalletConfig struct {
	Type            WalletType
	Address         string
	MinBalance      float64
	MaxBalance      float64
	TargetBalance   float64
	AutoTopUp       bool
	TopUpThreshold  float64
	TopUpAmount     float64
	IsActive        bool
	LastActivity    time.Time
}

type MultisigConfig struct {
	RequiredSignatures int
	TotalSigners      int
	SignerAddresses   []string
	TimelockSeconds   int
	IsActive          bool
}

type HSMService struct {
	endpoint    string
	apiKey      string
	timeout     time.Duration
	maxRetries  int
	mu          sync.RWMutex
}

type KeyManager struct {
	activeKeyID string
	keys        map[string]*Key
	rotationPeriod time.Duration
	lastRotation  time.Time
	mu            sync.RWMutex
}

type Key struct {
	KeyID       string
	KeyType     string // "master", "signing", "viewing"
	PublicKey   string
	EncryptedPrivateKey []byte
	CreatedAt   time.Time
	RotatedAt   time.Time
	ExpiresAt   time.Time
	IsActive    bool
}

type ApprovalWorkflow struct {
	minApprovalAmount float64
	maxAutoApproval   float64
	approvers         []string
	requires2FA       bool
	autoApprovalKycLevel int
	mu                sync.RWMutex
}

type TransactionQueue struct {
	pending    []*Transaction
	processing []*Transaction
	completed  []*Transaction
	maxSize    int
	mu         sync.RWMutex
}

type BalanceManager struct {
	reserves   map[string]float64
	debts      map[string]float64
	insurance  float64
	mu         sync.RWMutex
}

type NetworkClient interface {
	GetBalance(address string) (float64, error)
	SendTransaction(from, to string, amount float64, fee float64) (string, error)
	GetTransaction(hash string) (*Transaction, error)
	GetGasPrice() (float64, error)
	EstimateFee(to string, amount float64) (float64, error)
}

type SecurityService struct {
	rateLimit         map[string]*RateLimitEntry
	blacklist         map[string]bool
	whitelist         map[string]bool
	maxWithdrawalDaily float64
	mu                sync.RWMutex
}

type RateLimitEntry struct {
	Count     int
	Limit     int
	Window    time.Duration
	Timestamp time.Time
}

type EventEmitter struct {
	subscribers map[string][]chan interface{}
	mu          sync.RWMutex
}

func NewCustodyService() *CustodyService {
	cs := &CustodyService{
		hotWallet: &WalletConfig{
			Type:            HotWallet,
			MaxBalance:      10000000, // $10M max in hot
			TargetBalance:   5000000,
			AutoTopUp:       true,
			TopUpThreshold:  2000000,
			TopUpAmount:     3000000,
			IsActive:        true,
		},
		warmWallet: &WalletConfig{
			Type:            WarmWallet,
			MaxBalance:      50000000, // $50M max in warm
			TargetBalance:   25000000,
			IsActive:        true,
		},
		coldWallet: &WalletConfig{
			Type:            ColdWallet,
			MaxBalance:      500000000, // $500M max in cold
			IsActive:        true,
		},
		vaultWallet: &WalletConfig{
			Type:            VaultWallet,
			IsActive:        true,
		},
		operationsWallet: &WalletConfig{
			Type:            OperationsWallet,
			IsActive:        true,
		},
		multisig: &MultisigConfig{
			RequiredSignatures: 3,
			TotalSigners:      5,
			TimelockSeconds:   86400, // 24 hours
			IsActive:          true,
		},
		hsm: &HSMService{
			timeout:    30 * time.Second,
			maxRetries: 3,
		},
		keyManager: &KeyManager{
			keys:          make(map[string]*Key),
			rotationPeriod: 30 * 24 * time.Hour, // 30 days
		},
		approvalWorkflow: &ApprovalWorkflow{
			minApprovalAmount: 100000, // $100K requires approval
			maxAutoApproval:   10000,  // $10K auto-approved
			requires2FA:       true,
			autoApprovalKycLevel: 3,    // KYC level 3+
		},
		txQueue: &TransactionQueue{
			maxSize: 1000,
		},
		balanceManager: &BalanceManager{
			reserves: make(map[string]float64),
			debts:    make(map[string]float64),
			insurance: 0,
		},
		security: &SecurityService{
			maxWithdrawalDaily: 1000000, // $1M daily limit
		},
		events: &EventEmitter{
			subscribers: make(map[string][]chan interface{}),
		},
		networkClients: make(map[string]NetworkClient),
	}
	
	return cs
}

// =============================================================================
// DEPOSIT OPERATIONS
// =============================================================================

func (cs *CustodyService) ProcessDeposit(ctx context.Context, deposit *DepositRecord) error {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	
	// Validate deposit
	if err := cs.validateDeposit(deposit); err != nil {
		return fmt.Errorf("deposit validation failed: %w", err)
	}
	
	// Update confirmation status
	deposit.ConfirmedAt = time.Now()
	deposit.ProcessedAt = time.Now()
	
	// Credit user balance
	if err := cs.creditUser(deposit.UserID, deposit.Asset, deposit.Amount, deposit.WalletType); err != nil {
		return fmt.Errorf("failed to credit user: %w", err)
	}
	
	// Update wallet balance
	if err := cs.updateWalletBalance(deposit.WalletType, deposit.Asset, deposit.Amount); err != nil {
		log.Printf("Warning: failed to update wallet balance: %v", err)
	}
	
	// Emit event
	cs.events.Emit("deposit", deposit)
	
	return nil
}

func (cs *CustodyService) validateDeposit(deposit *DepositRecord) error {
	if deposit.Amount <= 0 {
		return errors.New("deposit amount must be positive")
	}
	
	if deposit.UserID == "" {
		return errors.New("user ID is required")
	}
	
	// Check minimum deposit
	minDeposit := cs.getMinDeposit(deposit.Asset)
	if deposit.Amount < minDeposit {
		return fmt.Errorf("deposit below minimum: %.8f", minDeposit)
	}
	
	return nil
}

func (cs *CustodyService) creditUser(userID, asset string, amount float64, walletType WalletType) error {
	// In production, this would update the database
	log.Printf("Crediting user %s with %.8f %s from %s wallet", userID, amount, asset, walletType)
	
	// Update total deposits
	cs.balanceManager.reserves[asset] += amount
	
	return nil
}

func (cs *CustodyService) updateWalletBalance(walletType WalletType, asset string, amount float64) error {
	log.Printf("Updating %s wallet balance for %s: +%.8f", walletType, asset, amount)
	return nil
}

func (cs *CustodyService) getMinDeposit(asset string) float64 {
	// Minimum deposit by asset
	minDeposits := map[string]float64{
		"BTC":  0.0001,
		"ETH":  0.001,
		"USDT": 1.0,
		"USDC": 1.0,
		"BNB":  0.01,
	}
	
	if min, ok := minDeposits[asset]; ok {
		return min
	}
	return 0.0001
}

// =============================================================================
// WITHDRAWAL OPERATIONS
// =============================================================================

func (cs *CustodyService) CreateWithdrawal(ctx context.Context, request *WithdrawalRequest) error {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	
	// Validate withdrawal request
	if err := cs.validateWithdrawalRequest(request); err != nil {
		return fmt.Errorf("validation failed: %w", err)
	}
	
	// Check user balance
	balance := cs.getUserBalance(request.UserID, request.Asset)
	if balance.Available < request.Amount {
		return errors.New("insufficient balance")
	}
	
	// Calculate fee and net amount
	fee := cs.calculateWithdrawalFee(request.Asset, request.Amount)
	request.Fee = fee
	request.NetAmount = request.Amount - fee
	
	// Set initial status
	request.Status = "pending"
	request.CreatedAt = time.Now()
	
	// Check if auto-approval is possible
	if cs.canAutoApprove(request) {
		request.Status = "approved"
		request.ApprovedAt = time.Now()
	}
	
	// Lock funds
	if err := cs.lockFunds(request.UserID, request.Asset, request.Amount); err != nil {
		return fmt.Errorf("failed to lock funds: %w", err)
	}
	
	// Emit event
	cs.events.Emit("withdrawal_request", request)
	
	return nil
}

func (cs *CustodyService) validateWithdrawalRequest(request *WithdrawalRequest) error {
	if request.Amount <= 0 {
		return errors.New("withdrawal amount must be positive")
	}
	
	if request.ToAddress == "" {
		return errors.New("destination address is required")
	}
	
	if request.UserID == "" {
		return errors.New("user ID is required")
	}
	
	// Check withdrawal limits
	if err := cs.checkWithdrawalLimits(request); err != nil {
		return err
	}
	
	// Validate address format
	if !cs.validateAddress(request.ToAddress, request.Chain) {
		return errors.New("invalid address format")
	}
	
	// Check KYC requirements
	if request.RequiresKyc && request.KycLevel < 2 {
		return errors.New("KYC level 2 required for withdrawals")
	}
	
	return nil
}

func (cs *CustodyService) checkWithdrawalLimits(request *WithdrawalRequest) error {
	cs.security.mu.RLock()
	defer cs.security.mu.RUnlock()
	
	// Check daily limit
	dailyTotal := cs.getDailyWithdrawalTotal(request.UserID)
	if dailyTotal+request.Amount > cs.security.maxWithdrawalDaily {
		return fmt.Errorf("daily withdrawal limit exceeded: %.2f", cs.security.maxWithdrawalDaily)
	}
	
	// Check rate limiting
	key := fmt.Sprintf("withdrawal:%s", request.IpAddress)
	if entry, ok := cs.security.rateLimit[key]; ok {
		if time.Since(entry.Timestamp) < entry.Window {
			if entry.Count >= entry.Limit {
				return errors.New("rate limit exceeded")
			}
		}
	}
	
	return nil
}

func (cs *CustodyService) canAutoApprove(request *WithdrawalRequest) bool {
	cs.approvalWorkflow.mu.RLock()
	defer cs.approvalWorkflow.mu.RUnlock()
	
	// Check amount threshold
	if request.Amount > cs.approvalWorkflow.maxAutoApproval {
		return false
	}
	
	// Check KYC level
	if request.KycLevel < cs.approvalWorkflow.autoApprovalKycLevel {
		return false
	}
	
	// Check address whitelist
	if !cs.isAddressWhitelisted(request.UserID, request.ToAddress) {
		return false
	}
	
	return true
}

func (cs *CustodyService) isAddressWhitelisted(userID, address string) bool {
	// In production, check whitelist database
	return false
}

func (cs *CustodyService) calculateWithdrawalFee(asset string, amount float64) float64 {
	// Fee structure by asset
	fees := map[string]struct {
		flat   float64
		percent float64
	}{
		"BTC":  {flat: 0.0005, percent: 0.0001},  // 0.5 mBTC + 0.01%
		"ETH":  {flat: 0.005, percent: 0.0001}, // 5 mETH + 0.01%
		"USDT": {flat: 1.0, percent: 0.0001},    // $1 + 0.01%
		"USDC": {flat: 1.0, percent: 0.0001},
		"BNB":  {flat: 0.003, percent: 0.0001},
	}
	
	if config, ok := fees[asset]; ok {
		return config.flat + amount*config.percent
	}
	
	// Default fee
	return amount * 0.001
}

func (cs *CustodyService) getUserBalance(userID, asset string) *UserBalance {
	// In production, query from database
	return &UserBalance{
		UserID:    userID,
		Asset:     asset,
		Available: 10000,
		Locked:    0,
	}
}

func (cs *CustodyService) lockFunds(userID, asset string, amount float64) error {
	log.Printf("Locking %.8f %s for user %s", amount, asset, userID)
	return nil
}

func (cs *CustodyService) getDailyWithdrawalTotal(userID string) float64 {
	// In production, sum today's withdrawals
	return 0
}

func (cs *CustodyService) validateAddress(address, chain string) bool {
	// Basic address validation by chain
	switch chain {
	case "BTC":
		// P2PKH, P2SH, Bech32 validation
		if len(address) < 26 || len(address) > 42 {
			return false
		}
		return true
	case "ETH", "ERC20":
		// Ethereum address validation
		if len(address) != 42 || address[:2] != "0x" {
			return false
		}
		return true
	default:
		return true
	}
}

// ApproveWithdrawal approves a withdrawal request
func (cs *CustodyService) ApproveWithdrawal(ctx context.Context, requestID, approverID string) error {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	
	// Verify approver has permission
	if !cs.isValidApprover(approverID) {
		return errors.New("invalid approver")
	}
	
	// Get request
	request := cs.getWithdrawalRequest(requestID)
	if request == nil {
		return errors.New("request not found")
	}
	
	if request.Status != "pending" {
		return errors.New("request already processed")
	}
	
	// Check multi-signature requirement
	if request.Amount > cs.approvalWorkflow.minApprovalAmount {
		// Add to multi-sig workflow
		return cs.addToMultisig(request, approverID)
	}
	
	// Direct approval
	request.Status = "approved"
	request.ApprovedBy = approverID
	request.ApprovedAt = time.Now()
	
	// Process withdrawal
	return cs.processWithdrawal(request)
}

func (cs *CustodyService) isValidApprover(approverID string) bool {
	cs.approvalWorkflow.mu.RLock()
	defer cs.approvalWorkflow.mu.RUnlock()
	
	for _, a := range cs.approvalWorkflow.approvers {
		if a == approverID {
			return true
		}
	}
	return false
}

func (cs *CustodyService) getWithdrawalRequest(requestID string) *WithdrawalRequest {
	// In production, query from database
	return nil
}

func (cs *CustodyService) addToMultisig(request *WithdrawalRequest, approverID string) error {
	// Add to multi-sig workflow
	log.Printf("Adding withdrawal %s to multisig workflow", request.RequestID)
	return nil
}

func (cs *CustodyService) processWithdrawal(request *WithdrawalRequest) error {
	// Select wallet based on amount and security requirements
	walletType := cs.selectWallet(request.Asset, request.Amount)
	
	// Create transaction
	tx := &Transaction{
		TxID:        fmt.Sprintf("tx-%s-%d", request.RequestID, time.Now().Unix()),
		Chain:       request.Chain,
		Asset:       request.Asset,
		Type:        Withdrawal,
		FromAddress: "", // From hot/cold wallet
		ToAddress:   request.ToAddress,
		Amount:      request.NetAmount,
		Fee:         request.Fee,
		WalletType:  walletType,
		Status:      TxPending,
		Timestamp:   time.Now(),
	}
	
	// Queue for processing
	cs.txQueue.Enqueue(tx)
	
	// Sign and broadcast
	go cs.signAndBroadcast(tx)
	
	request.Status = "processing"
	request.ProcessedAt = time.Now()
	
	return nil
}

func (cs *CustodyService) selectWallet(asset string, amount float64) WalletType {
	cs.mu.RLock()
	defer cs.mu.RUnlock()
	
	// Logic for selecting wallet based on amount and security
	if amount > 1000000 { // > $1M
		if cs.coldWallet.IsActive {
			return ColdWallet
		}
	}
	
	if amount > 100000 { // > $100K
		if cs.warmWallet.IsActive {
			return WarmWallet
		}
	}
	
	return HotWallet
}

func (cs *CustodyService) signAndBroadcast(tx *Transaction) error {
	// Sign transaction with HSM
	signature, err := cs.hsm.SignTransaction(tx)
	if err != nil {
		tx.Status = TxFailed
		return fmt.Errorf("signing failed: %w", err)
	}
	
	// Broadcast to network
	client, ok := cs.networkClients[tx.Chain]
	if !ok {
		tx.Status = TxFailed
		return errors.New("network client not found")
	}
	
	hash, err := client.SendTransaction(tx.FromAddress, tx.ToAddress, tx.Amount, tx.Fee)
	if err != nil {
		tx.Status = TxFailed
		return fmt.Errorf("broadcast failed: %w", err)
	}
	
	tx.Hash = hash
	tx.Status = TxConfirmed
	
	// Emit event
	cs.events.Emit("withdrawal_confirmed", tx)
	
	return nil
}

// =============================================================================
// COLD STORAGE MANAGEMENT
// =============================================================================

func (cs *CustodyService) SweepToCold(ctx context.Context, asset string, amount float64) error {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	
	// Get current hot wallet balance
	hotBalance := cs.getWalletBalance(HotWallet, asset)
	
	// Calculate sweep amount
	sweepAmount := hotBalance - cs.hotWallet.TargetBalance
	if amount > 0 {
		sweepAmount = math.Min(sweepAmount, amount)
	}
	
	if sweepAmount <= 0 {
		return errors.New("no funds to sweep")
	}
	
	// Create cold storage transaction
	allocation := &ColdStorageAllocation{
		AllocationID: fmt.Sprintf("alloc-%s-%d", asset, time.Now().Unix()),
		Asset:       asset,
		Amount:      sweepAmount,
		TargetWallet: cs.coldWallet.Address,
		WalletType:  ColdWallet,
		Status:      "pending",
		CreatedAt:   time.Now(),
	}
	
	// Require multisig for cold storage
	if cs.multisig.IsActive {
		return cs.initiateColdStorageMultisig(allocation)
	}
	
	// Direct execution
	return cs.executeColdStorageTransfer(allocation)
}

func (cs *CustodyService) initiateColdStorageMultisig(allocation *ColdStorageAllocation) error {
	// Create multisig request
	log.Printf("Initiating multisig for cold storage transfer: %.8f %s", allocation.Amount, allocation.Asset)
	
	// Require 3 of 5 signatures
	signatures := make([]string, 0)
	
	// This would be async and wait for signatures
	return nil
}

func (cs *CustodyService) executeColdStorageTransfer(allocation *ColdStorageAllocation) error {
	allocation.Status = "executed"
	allocation.ExecutedAt = time.Now()
	
	// Update balances
	cs.balanceManager.reserves[allocation.Asset] -= allocation.Amount
	
	log.Printf("Executed cold storage transfer: %.8f %s", allocation.Amount, allocation.Asset)
	
	return nil
}

func (cs *CustodyService) getWalletBalance(walletType WalletType, asset string) float64 {
	// In production, query actual wallet balance
	return 5000000 // Mock
}

// =============================================================================
// HSM OPERATIONS
// =============================================================================

func (hsm *HSMService) SignTransaction(tx *Transaction) (string, error) {
	hsm.mu.Lock()
	defer hsm.mu.Unlock()
	
	// In production, call HSM hardware
	// For now, generate mock signature
	
	// Create transaction hash
	data := fmt.Sprintf("%s:%s:%s:%.8f", tx.Asset, tx.FromAddress, tx.ToAddress, tx.Amount)
	hash := sha256.Sum256([]byte(data))
	
	// Generate signature
	sig := make([]byte, 64)
	if _, err := rand.Read(sig); err != nil {
		return "", err
	}
	
	return hex.EncodeToString(sig), nil
}

func (hsm *HSMService) GenerateKey() (string, string, error) {
	hsm.mu.Lock()
	defer hsm.mu.Unlock()
	
	// Generate key pair
	privateKey := make([]byte, 32)
	if _, err := rand.Read(privateKey); err != nil {
		return "", "", err
	}
	
	// Derive public key
	publicKey := sha256.Sum256(privateKey)
	
	return hex.EncodeToString(privateKey), hex.EncodeToString(publicKey[:]), nil
}

// =============================================================================
// KEY MANAGEMENT
// =============================================================================

func (km *KeyManager) RotateKeys(ctx context.Context) error {
	km.mu.Lock()
	defer km.mu.Unlock()
	
	// Check if rotation is needed
	if time.Since(km.lastRotation) < km.rotationPeriod {
		return nil
	}
	
	// Generate new key
	privateKey, publicKey, err := GenerateKeyPair()
	if err != nil {
		return fmt.Errorf("failed to generate key: %w", err)
	}
	
	// Create new key entry
	keyID := fmt.Sprintf("key-%d", time.Now().Unix())
	newKey := &Key{
		KeyID:     keyID,
		KeyType:   "signing",
		PublicKey: publicKey,
		CreatedAt: time.Now(),
		IsActive:  true,
	}
	
	// Encrypt private key before storage
	encryptedKey, err := km.encryptPrivateKey(privateKey)
	if err != nil {
		return fmt.Errorf("failed to encrypt key: %w", err)
	}
	newKey.EncryptedPrivateKey = encryptedKey
	
	// Store new key
	km.keys[keyID] = newKey
	
	// Deactivate old key
	if km.activeKeyID != "" {
		if oldKey, ok := km.keys[km.activeKeyID]; ok {
			oldKey.IsActive = false
			oldKey.RotatedAt = time.Now()
		}
	}
	
	km.activeKeyID = keyID
	km.lastRotation = time.Now()
	
	return nil
}

func (km *KeyManager) encryptPrivateKey(privateKey string) ([]byte, error) {
	// In production, use master key from secure storage
	masterKey := make([]byte, 32)
	rand.Read(masterKey)
	
	block, err := aes.NewCipher(masterKey)
	if err != nil {
		return nil, err
	}
	
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	
	nonce := make([]byte, gcm.NonceSize())
	rand.Read(nonce)
	
	return gcm.Seal(nonce, nonce, []byte(privateKey), nil), nil
}

// =============================================================================
// BALANCE MANAGEMENT
// =============================================================================

func (bm *BalanceManager) GetProofOfReserves() *ProofOfReserves {
	bm.mu.RLock()
	defer bm.mu.RUnlock()
	
	// Calculate total liabilities
	var totalLiabilities float64
	for asset, debt := range bm.debts {
		totalLiabilities += debt
	}
	
	// Calculate total assets
	var totalAssets float64
	for asset, reserve := range bm.reserves {
		totalAssets += reserve
	}
	
	return &ProofOfReserves{
		TotalAssets:      totalAssets,
		TotalLiabilities: totalLiabilities,
		Insurance:        bm.insurance,
		ReserveRatio:     totalLiabilities > 0 ? totalAssets / totalLiabilities : 0,
		Timestamp:        time.Now(),
	}
}

type ProofOfReserves struct {
	TotalAssets      float64
	TotalLiabilities float64
	Insurance        float64
	ReserveRatio     float64
	Timestamp        time.Time
}

// =============================================================================
// SECURITY OPERATIONS
// =============================================================================

func (ss *SecurityService) CheckRateLimit(key string, limit int, window time.Duration) bool {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	
	entry, ok := ss.rateLimit[key]
	if !ok {
		ss.rateLimit[key] = &RateLimitEntry{
			Count:     1,
			Limit:     limit,
			Window:    window,
			Timestamp: time.Now(),
		}
		return true
	}
	
	// Check if window has expired
	if time.Since(entry.Timestamp) > entry.Window {
		entry.Count = 1
		entry.Timestamp = time.Now()
		return true
	}
	
	// Check limit
	if entry.Count >= entry.Limit {
		return false
	}
	
	entry.Count++
	return true
}

func (ss *SecurityService) VerifySignature(message, signature, publicKey string) bool {
	// Verify HMAC signature
	expectedMAC := hmac.New(sha256.New, []byte(publicKey))
	expectedMAC.Write([]byte(message))
	expectedMACHash := expectedMAC.Sum(nil)
	
	signatureBytes, err := hex.DecodeString(signature)
	if err != nil {
		return false
	}
	
	return subtle.ConstantTimeCompare(signatureBytes, expectedMACHash) == 1
}

// =============================================================================
// EVENT EMITTER
// =============================================================================

func (ee *EventEmitter) Subscribe(event string) chan interface{} {
	ee.mu.Lock()
	defer ee.mu.Unlock()
	
	ch := make(chan interface{}, 100)
	ee.subscribers[event] = append(ee.subscribers[event], ch)
	return ch
}

func (ee *EventEmitter) Emit(event string, data interface{}) {
	ee.mu.RLock()
	defer ee.mu.RUnlock()
	
	if subs, ok := ee.subscribers[event]; ok {
		for _, ch := range subs {
			select {
			case ch <- data:
			default:
				// Channel full, skip
			}
		}
	}
}

// =============================================================================
// TRANSACTION QUEUE
// =============================================================================

func (tq *TransactionQueue) Enqueue(tx *Transaction) {
	tq.mu.Lock()
	defer tq.mu.Unlock()
	
	if len(tq.pending) >= tq.maxSize {
		// Remove oldest completed
		if len(tq.completed) > 0 {
			tq.completed = tq.completed[1:]
		}
	}
	
	tq.pending = append(tq.pending, tx)
}

func (tq *TransactionQueue) Dequeue() *Transaction {
	tq.mu.Lock()
	defer tq.mu.Unlock()
	
	if len(tq.pending) == 0 {
		return nil
	}
	
	tx := tq.pending[0]
	tq.pending = tq.pending[1:]
	tq.processing = append(tq.processing, tx)
	
	return tx
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

func GenerateKeyPair() (string, string, error) {
	privateKey := make([]byte, 32)
	if _, err := rand.Read(privateKey); err != nil {
		return "", "", err
	}
	
	publicKey := sha512.Sum256(privateKey)
	
	return hex.EncodeToString(privateKey), hex.EncodeToString(publicKey[:]), nil
}

func GenerateSecureRandom(length int) ([]byte, error) {
	b := make([]byte, length)
	if _, err := rand.Read(b); err != nil {
		return nil, err
	}
	return b, nil
}

// =============================================================================
// MAIN
// =============================================================================

func main() {
	log.Println("TigerEx Custody Service v3.0 Starting...")
	
	// Initialize custody service
	cs := NewCustodyService()
	
	// Start services
	ctx := context.Background()
	
	// Key rotation routine
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := cs.keyManager.RotateKeys(ctx); err != nil {
					log.Printf("Key rotation failed: %v", err)
				}
			}
		}
	}()
	
	// Cold storage sweep routine
	go func() {
		ticker := time.NewTicker(4 * time.Hour)
		defer ticker.Stop()
		
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				// Sweep excess to cold storage
				if err := cs.SweepToCold(ctx, "BTC", 0); err != nil {
					log.Printf("Cold sweep failed: %v", err)
				}
			}
		}
	}()
	
	// Transaction queue processor
	go func() {
		ticker := time.NewTicker(1 * time.Second)
		defer ticker.Stop()
		
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				tx := cs.txQueue.Dequeue()
				if tx != nil {
					log.Printf("Processing transaction: %s", tx.TxID)
				}
			}
		}
	}()
	
	// Get proof of reserves
	por := cs.balanceManager.GetProofOfReserves()
	log.Printf("Proof of Reserves: Assets=%.2f, Liabilities=%.2f, Ratio=%.2f%%", 
		por.TotalAssets, por.TotalLiabilities, por.ReserveRatio*100)
	
	// Subscribe to events
	depositCh := cs.events.Subscribe("deposit")
	withdrawalCh := cs.events.Subscribe("withdrawal_request")
	
	go func() {
		for {
			select {
			case data := <-depositCh:
				deposit := data.(*DepositRecord)
				log.Printf("New deposit: %s %.8f %s", deposit.UserID, deposit.Amount, deposit.Asset)
			case data := <-withdrawalCh:
				request := data.(*WithdrawalRequest)
				log.Printf("New withdrawal request: %s %.8f %s", request.UserID, request.Amount, request.Asset)
			}
		}
	}()
	
	<-ctx.Done()
}

// ToJSON converts transaction to JSON
func (tx *Transaction) ToJSON() ([]byte, error) {
	return json.Marshal(tx)
}

// ToJSON converts withdrawal request to JSON
func (wr *WithdrawalRequest) ToJSON() ([]byte, error) {
	return json.Marshal(wr)
}

// ToJSON converts deposit record to JSON
func (dr *DepositRecord) ToJSON() ([]byte, error) {
	return json.Marshal(dr)
}

// ToJSON converts proof of reserves to JSON
func (por *ProofOfReserves) ToJSON() ([]byte, error) {
	return json.Marshal(por)
}

// FromJSON parses transaction from JSON
func (tx *Transaction) FromJSON(data []byte) error {
	return json.Unmarshal(data, tx)
}

// FromJSON parses withdrawal request from JSON
func (wr *WithdrawalRequest) FromJSON(data []byte) error {
	return json.Unmarshal(data, wr)
}

// FromJSON parses deposit record from JSON
func (dr *DepositRecord) FromJSON(data []byte) error {
	return json.Unmarshal(data, dr)
}

// VerifyWithdrawalSignature verifies withdrawal request signature
func (cs *CustodyService) VerifyWithdrawalSignature(request *WithdrawalRequest, signature string) bool {
	cs.security.mu.RLock()
	defer cs.security.mu.RUnlock()
	
	// Create message to verify
	message := fmt.Sprintf("%s:%s:%s:%.8f:%s", 
		request.RequestID, request.UserID, request.ToAddress, request.Amount, request.Asset)
	
	// In production, verify against stored public key
	return cs.security.VerifySignature(message, signature, request.UserID)
}

// AddAddressToWhitelist adds an address to user's whitelist
func (cs *CustodyService) AddAddressToWhitelist(userID, address, label string) error {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	
	log.Printf("Adding address %s to whitelist for user %s", address, userID)
	return nil
}

// RemoveAddressFromWhitelist removes an address from user's whitelist
func (cs *CustodyService) RemoveAddressFromWhitelist(userID, address string) error {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	
	log.Printf("Removing address %s from whitelist for user %s", address, userID)
	return nil
}

// GetWithdrawalAddresses returns user's whitelisted addresses
func (cs *CustodyService) GetWithdrawalAddresses(userID string) []*Address {
	// In production, query from database
	return nil
}

// CancelWithdrawal cancels a pending withdrawal
func (cs *CustodyService) CancelWithdrawal(requestID, userID string) error {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	
	request := cs.getWithdrawalRequest(requestID)
	if request == nil {
		return errors.New("request not found")
	}
	
	if request.UserID != userID {
		return errors.New("unauthorized")
	}
	
	if request.Status != "pending" {
		return errors.New("cannot cancel non-pending request")
	}
	
	// Unlock funds
	if err := cs.unlockFunds(request.UserID, request.Asset, request.Amount); err != nil {
		return err
	}
	
	request.Status = TxCancelled
	request.RejectedAt = time.Now()
	request.RejectedBy = userID
	
	return nil
}

func (cs *CustodyService) unlockFunds(userID, asset string, amount float64) error {
	log.Printf("Unlocking %.8f %s for user %s", amount, asset, userID)
	return nil
}

// GetWalletStatus returns the status of all wallets
func (cs *CustodyService) GetWalletStatus() map[string]interface{} {
	cs.mu.RLock()
	defer cs.mu.RUnlock()
	
	return map[string]interface{}{
		"hot":      cs.hotWallet,
		"warm":     cs.warmWallet,
		"cold":     cs.coldWallet,
		"vault":    cs.vaultWallet,
		"operations": cs.operationsWallet,
		"multisig": cs.multisig,
	}
}

// GetUserTotalBalance returns user's total balance across all assets
func (cs *CustodyService) GetUserTotalBalance(userID string) []*UserBalance {
	// In production, aggregate from database
	return nil
}

// SetWalletThreshold sets threshold for automatic wallet operations
func (cs *CustodyService) SetWalletThreshold(walletType WalletType, thresholdType string, value float64) error {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	
	switch walletType {
	case HotWallet:
		switch thresholdType {
		case "min":
			cs.hotWallet.MinBalance = value
		case "max":
			cs.hotWallet.MaxBalance = value
		case "target":
			cs.hotWallet.TargetBalance = value
		case "topup_threshold":
			cs.hotWallet.TopUpThreshold = value
		case "topup_amount":
			cs.hotWallet.TopUpAmount = value
		}
	}
	
	return nil
}

// Verify2FA verifies two-factor authentication
func (cs *CustodyService) Verify2FA(userID, code string) bool {
	// In production, verify TOTP code
	return len(code) == 6
}

// =============================================================================
// NETWORK CLIENTS (stub implementations)
// =============================================================================

type EthereumClient struct {
	endpoint string
}

func (ec *EthereumClient) GetBalance(address string) (float64, error) {
	return 0, nil
}

func (ec *EthereumClient) SendTransaction(from, to string, amount, fee float64) (string, error) {
	return "", nil
}

func (ec *EthereumClient) GetTransaction(hash string) (*Transaction, error) {
	return nil, nil
}

func (ec *EthereumClient) GetGasPrice() (float64, error) {
	return 0.00001, nil
}

func (ec *EthereumClient) EstimateFee(to string, amount float64) (float64, error) {
	return 0.0001, nil
}

type BitcoinClient struct {
	endpoint string
}

func (bc *BitcoinClient) GetBalance(address string) (float64, error) {
	return 0, nil
}

func (bc *BitcoinClient) SendTransaction(from, to string, amount, fee float64) (string, error) {
	return "", nil
}

func (bc *BitcoinClient) GetTransaction(hash string) (*Transaction, error) {
	return nil, nil
}

func (bc *BitcoinClient) GetGasPrice() (float64, error) {
	return 0.00001, nil
}

func (bc *BitcoinClient) EstimateFee(to string, amount float64) (float64, error) {
	return 0.0001, nil
}