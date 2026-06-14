package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"
	"time"
)

// ============================================================================
// SUB-ACCOUNTS SYSTEM
// Full-featured sub-account management for institutional and enterprise users
// ============================================================================

// ============================================================================
// TYPES
// ============================================================================

// AccountType represents the type of account
type AccountType string

const (
	AccountTypeSpot    AccountType = "SPOT"
	AccountTypeMargin AccountType = "MARGIN"
	AccountTypeFutures AccountType = "FUTURES"
	AccountTypeLeveraged AccountType = "LEVERAGED"
)

// AccountStatus represents account status
type AccountStatus string

const (
	AccountStatusActive    AccountStatus = "ACTIVE"
	AccountStatusLocked  AccountStatus = "LOCKED"
	AccountStatusSuspended AccountStatus = "SUSPENDED"
	AccountStatusClosed  AccountStatus = "CLOSED"
)

// SubAccount represents a sub-account
type SubAccount struct {
	ID             string
	ParentID      string
	Name          string
	AccountType  AccountType
	Status       AccountStatus
	APIKey       string
	APIKeySecret string
	
	// Permissions
	CanTrade     bool
	CanWithdraw bool
	CanTransfer bool
	CanView     bool
	
	// Limits
	DailyWithdrawLimit  float64
	monthlyTradeLimit float64
	
	// Balances
	Balances map[string]float64
	
	// Metadata
	CreatedAt  time.Time
	UpdatedAt time.Time
	LastActive time.Time
}

// ============================================================================
// SUB-ACCOUNT SERVICE
// ============================================================================

// Service manages sub-accounts
type Service struct {
	mu          sync.RWMutex
	accounts    map[string]*SubAccount
	byParentID map[string]map[string]*SubAccount
	apiKeys   map[string]*SubAccount // API key -> sub-account
	
	// Counters
	accountCounter int64
}

// NewService creates a new sub-account service
func NewService() *Service {
	return &Service{
		accounts:    make(map[string]*SubAccount),
		byParentID: make(map[string]map[string]*SubAccount),
		apiKeys:    make(map[string]*SubAccount),
	}
}

// ============================================================================
// CREATE SUB-ACCOUNT
// ============================================================================

// CreateRequest represents a create sub-account request
type CreateRequest struct {
	ParentID          string
	Name             string
	AccountType      AccountType
	CanTrade         bool
	CanWithdraw     bool
	CanTransfer    bool
	CanView        bool
	DailyWithdrawLimit float64
	MonthlyTradeLimit float64
}

// Create creates a new sub-account
func (s *Service) Create(req *CreateRequest) (*SubAccount, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	// Validate parent exists
	parent, ok := s.accounts[req.ParentID]
	if !ok {
		return nil, fmt.Errorf("parent account not found")
	}
	
	// Generate unique ID
	s.accountCounter++
	accountID := fmt.Sprintf("SUB%d%08d", time.Now().Unix(), s.accountCounter)
	
	// Generate API keys
	apiKey, apiSecret := generateAPIKeys()
	
	// Create sub-account
	account := &SubAccount{
		ID:             accountID,
		ParentID:      req.ParentID,
		Name:         req.Name,
		AccountType:  req.AccountType,
		Status:      AccountStatusActive,
		APIKey:     apiKey,
		APIKeySecret: apiSecret,
		
		CanTrade:    req.CanTrade,
		CanWithdraw: req.CanWithdraw,
		CanTransfer: req.CanTransfer,
		CanView:    req.CanView,
		
		DailyWithdrawLimit:  req.DailyWithdrawLimit,
		MonthlyTradeLimit: req.MonthlyTradeLimit,
		
		Balances: make(map[string]float64),
		
		CreatedAt:  time.Now(),
		UpdatedAt: time.Now(),
		LastActive: time.Now(),
	}
	
	// Store
	s.accounts[accountID] = account
	s.apiKeys[apiKey] = account
	
	// Index by parent
	if s.byParentID[req.ParentID] == nil {
		s.byParentID[req.ParentID] = make(map[string]*SubAccount)
	}
	s.byParentID[req.ParentID][accountID] = account
	
	return account, nil
}

// ============================================================================
// MANAGE SUB-ACCOUNT
// ============================================================================

// Update updates a sub-account
func (s *Service) Update(accountID string, req *CreateRequest) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	account, ok := s.accounts[accountID]
	if !ok {
		return fmt.Errorf("account not found")
	}
	
	if req.Name != "" {
		account.Name = req.Name
	}
	account.CanTrade = req.CanTrade
	account.CanWithdraw = req.CanWithdraw
	account.CanTransfer = req.CanTransfer
	account.CanView = req.CanView
	account.DailyWithdrawLimit = req.DailyWithdrawLimit
	account.MonthlyTradeLimit = req.MonthlyTradeLimit
	account.UpdatedAt = time.Now()
	
	return nil
}

// UpdatePermissions updates sub-account permissions
func (s *Service) UpdatePermissions(accountID string, perms *CreateRequest) error {
	return s.Update(accountID, perms)
}

// Lock locks a sub-account
func (s *Service) Lock(accountID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	account, ok := s.accounts[accountID]
	if !ok {
		return fmt.Errorf("account not found")
	}
	
	account.Status = AccountStatusLocked
	account.UpdatedAt = time.Now()
	
	return nil
}

// Unlock unlocks a sub-account
func (s *Service) Unlock(accountID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	account, ok := s.accounts[accountID]
	if !ok {
		return fmt.Errorf("account not found")
	}
	
	account.Status = AccountStatusActive
	account.UpdatedAt = time.Now()
	
	return nil
}

// Delete deletes a sub-account
func (s *Service) Delete(accountID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	account, ok := s.accounts[accountID]
	if !ok {
		return fmt.Errorf("account not found")
	}
	
	// Check balance
	for _, balance := range account.Balances {
		if balance > 0 {
			return fmt.Errorf("cannot delete account with remaining balance")
		}
	}
	
	// Remove
	delete(s.byParentID[account.ParentID], accountID)
	delete(s.accounts, accountID)
	delete(s.apiKeys, account.APIKey)
	
	return nil
}

// ============================================================================
// QUERY SUB-ACCOUNTS
// ============================================================================

// Get gets a sub-account by ID
func (s *Service) Get(accountID string) (*SubAccount, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	account, ok := s.accounts[accountID]
	if !ok {
		return nil, fmt.Errorf("account not found")
	}
	
	return account, nil
}

// GetByParent gets all sub-accounts for a parent
func (s *Service) GetByParent(parentID string) []*SubAccount {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	accounts := s.byParentID[parentID]
	if accounts == nil {
		return []*SubAccount{}
	}
	
	result := make([]*SubAccount, 0, len(accounts))
	for _, account := range accounts {
		result = append(result, account)
	}
	
	return result
}

// GetByAPIKey gets sub-account by API key
func (s *Service) GetByAPIKey(apiKey string) (*SubAccount, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	account, ok := s.apiKeys[apiKey]
	if !ok {
		return nil, fmt.Errorf("API key not found")
	}
	
	return account, nil
}

// ============================================================================
// BALANCE MANAGEMENT
// ============================================================================

// Deposit deposits funds to a sub-account
func (s *Service) Deposit(accountID, asset string, amount float64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	account, ok := s.accounts[accountID]
	if !ok {
		return fmt.Errorf("account not found")
	}
	
	if account.Status != AccountStatusActive {
		return fmt.Errorf("account not active")
	}
	
	account.Balances[asset] += amount
	account.LastActive = time.Now()
	
	return nil
}

// Withdraw withdraws funds from a sub-account
func (s *Service) Withdraw(accountID, asset string, amount float64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	account, ok := s.accounts[accountID]
	if !ok {
		return fmt.Errorf("account not found")
	}
	
	if account.Status != AccountStatusActive {
		return fmt.Errorf("account not active")
	}
	
	if !account.CanWithdraw {
		return fmt.Errorf("withdraw not permitted")
	}
	
	if amount > account.DailyWithdrawLimit && account.DailyWithdrawLimit > 0 {
		return fmt.Errorf("exceeds daily limit")
	}
	
	current := account.Balances[asset]
	if current < amount {
		return fmt.Errorf("insufficient balance")
	}
	
	account.Balances[asset] -= amount
	account.LastActive = time.Now()
	
	return nil
}

// Transfer transfers funds between sub-accounts
func (s *Service) Transfer(fromID, toID, asset string, amount float64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	from, ok := s.accounts[fromID]
	if !ok {
		return fmt.Errorf("from account not found")
	}
	
	to, ok := s.accounts[toID]
	if !ok {
		return fmt.Errorf("to account not found")
	}
	
	if !from.CanTransfer {
		return fmt.Errorf("transfer not permitted")
	}
	
	if from.Status != AccountStatusActive || to.Status != AccountStatusActive {
		return fmt.Errorf("account not active")
	}
	
	current := from.Balances[asset]
	if current < amount {
		return fmt.Errorf("insufficient balance")
	}
	
	from.Balances[asset] -= amount
	to.Balances[asset] += amount
	from.LastActive = time.Now()
	to.LastActive = time.Now()
	
	return nil
}

// ============================================================================
// PERMISSION CHECKING
// ============================================================================

// CanTrade checks if account can trade
func (s *Service) CanTrade(accountID string) bool {
	account, _ := s.Get(accountID)
	return account != nil && account.CanTrade && account.Status == AccountStatusActive
}

// CanWithdraw checks if account can withdraw
func (s *Service) CanWithdraw(accountID string) bool {
	account, _ := s.Get(accountID)
	return account != nil && account.CanWithdraw && account.Status == AccountStatusActive
}

// ============================================================================
// SERIALIZATION
// ============================================================================

// ToJSON serializes to JSON
func (a *SubAccount) ToJSON() (string, error) {
	return json.Marshal(a)
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

func generateAPIKeys() (string, string) {
	// Generate random API key
	pubKey, privKey, _ := ed25519.GenerateKey(rand.Reader)
	
	apiKey := hex.EncodeToString(pubKey[:16])
	apiSecret := hex.EncodeToString(privKey[:32])
	
	return apiKey, apiSecret
}

// ============================================================================
// EXAMPLE
// ============================================================================

func main() {
	fmt.Println("TigerEx Sub-Accounts System v1.0.0")
	
	// Create service
	service := NewService()
	
	// Create main account (parent)
	parent := &SubAccount{
		ID:          "MAIN001",
		Name:        "Main Account",
		AccountType: AccountTypeSpot,
		Status:     AccountStatusActive,
		Balances:   map[string]float64{"USDT": 100000},
	}
	service.accounts[parent.ID] = parent
	
	// Create sub-account
	req := &CreateRequest{
		ParentID:          "MAIN001",
		Name:             "Trading Bot",
		AccountType:      AccountTypeSpot,
		CanTrade:         true,
		CanWithdraw:     false,
		CanTransfer:    false,
		CanView:        true,
		DailyWithdrawLimit: 10000,
	}
	
	sub, err := service.Create(req)
	if err != nil {
		fmt.Println("Error:", err)
		return
	}
	
	fmt.Printf("Created sub-account: %s\n", sub.ID)
	fmt.Printf("API Key: %s\n", sub.APIKey)
	
	// Test deposit
	service.Deposit(sub.ID, "USDT", 50000)
	
	fmt.Printf("Balance USDT: %.2f\n", sub.Balances["USDT"])
}