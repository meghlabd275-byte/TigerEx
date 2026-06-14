package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"
	"time"
)

// ============================================================================
// CUSTODY SERVICE
// Institutional-grade custody solution for digital assets
// ============================================================================

// ============================================================================
// TYPES
// ============================================================================

// Custodian represents a custodian
type Custodian struct {
	ID           string
	Name         string
	LicenseNumber string
	InsuranceLimit float64
	Jurisdiction string
	Features    []string
	Fee         float64 // Annual fee percentage
}

// CustodyAccount represents a custody account
type CustodyAccount struct {
	ID          string
	UserID     string
	CustodianID string
	AccountNumber string
	AccountType  AccountType
	Balance    map[string]float64
	Status     CustodyStatus
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

type AccountType string

const (
	AccountTypeIndividual AccountType = "INDIVIDUAL"
	AccountTypeCorporate AccountType = "CORPORATE"
	AccountTypeInstitutional AccountType = "INSTITUTIONAL"
)

type CustodyStatus string

const (
	CustodyStatusActive CustodyStatus = "ACTIVE"
	CustodyStatusSuspended CustodyStatus = "SUSPENDED"
	CustodyStatusClosed CustodyStatus = "CLOSED"
)

// Transfer represents a custody transfer
type Transfer struct {
	ID            string
	AccountID    string
	Type        TransferType
	Asset       string
	Amount      float64
	FromAccount string
	ToAccount   string
	Status     TransferStatus
	TxHash     string
	CreatedAt  time.Time
	ProcessedAt *time.Time
}

type TransferType string

const (
	TransferTypeDeposit    TransferType = "DEPOSIT"
	TransferTypeWithdrawal TransferType = "WITHDRAWAL"
	TransferTypeInternal  TransferType = "INTERNAL"
)

type TransferStatus string

const (
	TransferStatusPending   TransferStatus = "PENDING"
	TransferStatusProcessing TransferStatus = "PROCESSING"
	TransferStatusCompleted TransferStatus = "COMPLETED"
	TransferStatusFailed  TransferStatus = "FAILED"
)

// AuditRecord represents an audit record
type AuditRecord struct {
	ID          string
	AccountID   string
	Action     string
	Asset      string
	Amount     float64
	BalanceBefore float64
	BalanceAfter float64
	OperatorID string
	IPAddress  string
	Timestamp  time.Time
}

// ============================================================================
// SERVICE
// ============================================================================

type CustodyService struct {
	mu          sync.RWMutex
	custodians map[string]*Custodian
	accounts   map[string]*CustodyAccount
	transfers  map[string]*Transfer
	audits    []AuditRecord
	
	accountCounter int64
	transferCounter int64
}

func NewCustodyService() *CustodyService {
	cs := &CustodyService{
		custodians: make(map[string]*Custodian),
		accounts:  make(map[string]*CustodyAccount),
		transfers: make(map[string]*Transfer),
		audits:    []AuditRecord{},
	}
	
	// Initialize default custodians
	cs.initCustodians()
	
	return cs
}

func (cs *CustodyService) initCustodians() {
	cs.custodians["custodian_1"] = &Custodian{
		ID:            "custodian_1",
		Name:          "TigerEx Custody",
		LicenseNumber: "CUST-LIC-001",
		InsuranceLimit: 100_000_000,
		Jurisdiction:  "Singapore",
		Features:     []string{"Cold Storage", "Multi-Sig", "Insurance", "Audit"},
		Fee:          0.1, // 0.1% annual
	}
	
	cs.custodians["custodian_2"] = &Custodian{
		ID:            "custodian_2",
		Name:          "TigerEx Institutional",
		LicenseNumber: "INST-LIC-001",
		InsuranceLimit: 500_000_000,
		Jurisdiction:  "Switzerland",
		Features:     []string{"Cold Storage", "HSM", "Insurance", "Audit", "Reporting"},
		Fee:          0.05, // 0.05% annual
	}
}

// ============================================================================
// ACCOUNT OPERATIONS
// ============================================================================

func (cs *CustodyService) CreateAccount(userID, custodianID string, accountType AccountType) (*CustodyAccount, error) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	
	// Validate custodian
	custodian, ok := cs.custodians[custodianID]
	if !ok {
		return nil, fmt.Errorf("custodian not found")
	}
	
	cs.accountCounter++
	account := &CustodyAccount{
		ID:           fmt.Sprintf("CUST%010d", cs.accountCounter),
		UserID:       userID,
		CustodianID:  custodianID,
		AccountNumber: generateAccountNumber(),
		AccountType:  accountType,
		Balance:      make(map[string]float64),
		Status:      CustodyStatusActive,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	
	cs.accounts[account.ID] = account
	
	// Create audit record
	cs.createAudit(account.ID, "CREATE_ACCOUNT", "", 0, 0, 0, "SYSTEM", "")
	
	return account, nil
}

func (cs *CustodyService) GetAccount(accountID string) (*CustodyAccount, error) {
	cs.mu.RLock()
	defer cs.mu.RUnlock()
	
	account, ok := cs.accounts[accountID]
	if !ok {
		return nil, fmt.Errorf("account not found")
	}
	
	return account, nil
}

func (cs *CustodyService) GetAccountsByUser(userID string) []*CustodyAccount {
	cs.mu.RLock()
	defer cs.mu.RUnlock()
	
	var result []*CustodyAccount
	for _, account := range cs.accounts {
		if account.UserID == userID {
			result = append(result, account)
		}
	}
	
	return result
}

// ============================================================================
// BALANCE OPERATIONS
// ============================================================================

func (cs *CustodyService) Deposit(accountID, asset string, amount float64, operatorID, ipAddress string) error {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	
	account, ok := cs.accounts[accountID]
	if !ok {
		return fmt.Errorf("account not found")
	}
	
	if account.Status != CustodyStatusActive {
		return fmt.Errorf("account not active")
	}
	
	balanceBefore := account.Balance[asset]
	account.Balance[asset] += amount
	account.UpdatedAt = time.Now()
	
	// Create transfer
	cs.transferCounter++
	transfer := &Transfer{
		ID:         fmt.Sprintf("TRF%010d", cs.transferCounter),
		AccountID:  accountID,
		Type:       TransferTypeDeposit,
		Asset:      asset,
		Amount:     amount,
		ToAccount:  account.AccountNumber,
		Status:     TransferStatusCompleted,
		CreatedAt:  time.Now(),
	}
	now := time.Now()
	transfer.ProcessedAt = &now
	cs.transfers[transfer.ID] = transfer
	
	// Create audit
	cs.createAudit(account.ID, "DEPOSIT", asset, amount, balanceBefore, account.Balance[asset], operatorID, ipAddress)
	
	return nil
}

func (cs *CustodyService) Withdraw(accountID, asset string, amount float64, operatorID, ipAddress string) error {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	
	account, ok := cs.accounts[accountID]
	if !ok {
		return fmt.Errorf("account not found")
	}
	
	if account.Status != CustodyStatusActive {
		return fmt.Errorf("account not active")
	}
	
	balanceBefore := account.Balance[asset]
	if balanceBefore < amount {
		return fmt.Errorf("insufficient balance")
	}
	
	account.Balance[asset] -= amount
	account.UpdatedAt = time.Now()
	
	// Create transfer
	cs.transferCounter++
	transfer := &Transfer{
		ID:          fmt.Sprintf("TRF%010d", cs.transferCounter),
		AccountID:  accountID,
		Type:       TransferTypeWithdrawal,
		Asset:      asset,
		Amount:     amount,
		FromAccount: account.AccountNumber,
		Status:     TransferStatusCompleted,
		CreatedAt:  time.Now(),
	}
	now := time.Now()
	transfer.ProcessedAt = &now
	cs.transfers[transfer.ID] = transfer
	
	// Create audit
	cs.createAudit(account.ID, "WITHDRAWAL", asset, amount, balanceBefore, account.Balance[asset], operatorID, ipAddress)
	
	return nil
}

func (cs *CustodyService) GetBalance(accountID, asset string) (float64, error) {
	cs.mu.RLock()
	defer cs.mu.RUnlock()
	
	account, ok := cs.accounts[accountID]
	if !ok {
		return 0, fmt.Errorf("account not found")
	}
	
	return account.Balance[asset], nil
}

// ============================================================================
// TRANSFERS
// ============================================================================

func (cs *CustodyService) InternalTransfer(fromAccountID, toAccountID, asset string, amount float64, operatorID, ipAddress string) error {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	
	fromAccount, ok := cs.accounts[fromAccountID]
	if !ok {
		return fmt.Errorf("from account not found")
	}
	
	toAccount, ok := cs.accounts[toAccountID]
	if !ok {
		return fmt.Errorf("to account not found")
	}
	
	if fromAccount.Balance[asset] < amount {
		return fmt.Errorf("insufficient balance")
	}
	
	// Execute transfer
	fromBalanceBefore := fromAccount.Balance[asset]
	toBalanceBefore := toAccount.Balance[asset]
	
	fromAccount.Balance[asset] -= amount
	toAccount.Balance[asset] += amount
	
	// Create transfer record
	cs.transferCounter++
	transfer := &Transfer{
		ID:         fmt.Sprintf("TRF%010d", cs.transferCounter),
		AccountID:  fromAccountID,
		Type:       TransferTypeInternal,
		Asset:      asset,
		Amount:     amount,
		FromAccount: fromAccount.AccountNumber,
		ToAccount:  toAccount.AccountNumber,
		Status:     TransferStatusCompleted,
		CreatedAt:  time.Now(),
	}
	now := time.Now()
	transfer.ProcessedAt = &now
	cs.transfers[transfer.ID] = transfer
	
	// Audit records
	cs.createAudit(fromAccount.ID, "INTERNAL_TRANSFER_OUT", asset, amount, fromBalanceBefore, fromAccount.Balance[asset], operatorID, ipAddress)
	cs.createAudit(toAccount.ID, "INTERNAL_TRANSFER_IN", asset, amount, toBalanceBefore, toAccount.Balance[asset], operatorID, ipAddress)
	
	return nil
}

func (cs *CustodyService) GetTransferHistory(accountID string) []*Transfer {
	cs.mu.RLock()
	defer cs.mu.RUnlock()
	
	var result []*Transfer
	for _, transfer := range cs.transfers {
		if transfer.AccountID == accountID {
			result = append(result, transfer)
		}
	}
	
	return result
}

// ============================================================================
// AUDIT
// ============================================================================

func (cs *CustodyService) createAudit(accountID, action, asset string, amount, balanceBefore, balanceAfter float64, operatorID, ipAddress string) {
	audit := AuditRecord{
		ID:           generateAuditID(),
		AccountID:    accountID,
		Action:       action,
		Asset:        asset,
		Amount:       amount,
		BalanceBefore: balanceBefore,
		BalanceAfter:  balanceAfter,
		OperatorID:   operatorID,
		IPAddress:    ipAddress,
		Timestamp:    time.Now(),
	}
	
	cs.audits = append(cs.audits, audit)
}

func (cs *CustodyService) GetAuditLog(accountID string, limit int) []AuditRecord {
	cs.mu.RLock()
	defer cs.mu.RUnlock()
	
	var result []AuditRecord
	count := 0
	for i := len(cs.audits) - 1; i >= 0 && count < limit; i-- {
		if cs.audits[i].AccountID == accountID {
			result = append(result, cs.audits[i])
			count++
		}
	}
	
	return result
}

// ============================================================================
// HELPER
// ============================================================================

func generateAccountNumber() string {
	b := make([]byte, 8)
	rand.Read(b)
	return fmt.Sprintf("CUST-%s-%s", time.Now().Format("200601"), hex.EncodeToString(b)[:8])
}

func generateAuditID() string {
	b := make([]byte, 8)
	rand.Read(b)
	hash := sha256.Sum256(b)
	return hex.EncodeToString(hash[:])
}

func main() {
	fmt.Println("TigerEx Custody Service v1.0.0")
	
	custody := NewCustodyService()
	
	// Create account
	account, _ := custody.CreateAccount("user1", "custodian_1", AccountTypeInstitutional)
	fmt.Printf("Created account: %s\n", account.AccountNumber)
	
	// Deposit
	custody.Deposit(account.ID, "BTC", 100.5, "admin", "192.168.1.1")
	
	// Get balance
	balance, _ := custody.GetBalance(account.ID, "BTC")
	fmt.Printf("BTC Balance: %.8f\n", balance)
	
	// Withdraw
	custody.Withdraw(account.ID, "BTC", 10.5, "admin", "192.168.1.1")
	
	// Get audit log
	audits := custody.GetAuditLog(account.ID, 10)
	fmt.Printf("Audit records: %d\n", len(audits))
}