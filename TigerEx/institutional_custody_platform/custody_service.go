// =============================================================================
// TIGEREX INSTITUTIONAL CUSTODY PLATFORM
// Institutional-grade digital asset custody and governance
// Built with Go for high-load worldwide distributed systems
// =============================================================================

package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math/big"
	"sync"
	"time"
)

// =============================================================================
// TYPES
// =============================================================================

// CustodyAccount represents institutional custody account
type CustodyAccount struct {
	ID                string            `json:"id"`
	InstitutionID     string            `json:"institutionId"`
	Name              string            `json:"name"`
	Type              string            `json:"type"` // CORPORATE, FUND, EXCHANGE, HEDGE_FUND
	Status            string            `json:"status"` // ACTIVE, FROZEN, CLOSED
	Balances          map[string]*big.Float `json:"balances"`
	Signers          []string          `json:"signers"` // Authorized signers
	Threshold         int              `json:"threshold"` // Required signatures
	CreatedAt         time.Time         `json:"createdAt"`
	UpdatedAt         time.Time         `json:"updatedAt"`
}

// TransactionRequest represents custody transaction request
type TransactionRequest struct {
	ID              string            `json:"id"`
	AccountID       string            `json:"accountId"`
	Type            string            `json:"type"` // WITHDRAWAL, TRANSFER, INTERNAL
	Asset           string            `json:"asset"`
	Amount          *big.Float        `json:"amount"`
	Destination     string            `json:"destination"`
	Status          string            `json:"status"` // PENDING, APPROVED, REJECTED, EXECUTED
	RequestedBy     string            `json:"requestedBy"`
	ApprovedBy      []string          `json:"approvedBy"`
	Signatures      map[string]string `json:"signatures"`
	ExecutedAt      *time.Time        `json:"executedAt"`
	CreatedAt       time.Time         `json:"createdAt"`
}

// ApprovalPolicy represents approval policy
type ApprovalPolicy struct {
	ID              string   `json:"id"`
	AccountID       string   `json:"accountId"`
	MinApprovers    int      `json:"minApprovers"`
	AmountThreshold *big.Float `json:"amountThreshold"` // Above this requires more approvals
	RequiredRoles   []string `json:"requiredRoles"`
}

// AuditRecord represents audit record
type AuditRecord struct {
	ID          string    `json:"id"`
	AccountID   string    `json:"accountId"`
	Action      string    `json:"action"`
	Actor       string    `json:"actor"`
	Details     string    `json:"details"`
	IPAddress   string    `json:"ipAddress"`
	Timestamp   time.Time `json:"timestamp"`
}

// =============================================================================
// CUSTODY SERVICE
// =============================================================================

// CustodyService handles institutional custody
type CustodyService struct {
	mu            sync.RWMutex
	accounts      map[string]*CustodyAccount
	transactions  map[string]*TransactionRequest
	policies      map[string]*ApprovalPolicy
	auditRecords  []AuditRecord
}

// NewCustodyService creates new custody service
func NewCustodyService() *CustodyService {
	svc := &CustodyService{
		accounts:     make(map[string]*CustodyAccount),
		transactions: make(map[string]*TransactionRequest),
		policies:     make(map[string]*ApprovalPolicy),
		auditRecords: make([]AuditRecord, 0),
	}
	return svc
}

func (s *CustodyService) CreateAccount(instID, name, accountType string, signers []string, threshold int) *CustodyAccount {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	account := &CustodyAccount{
		ID:            generateCustodyID(),
		InstitutionID: instID,
		Name:          name,
		Type:          accountType,
		Status:        "ACTIVE",
		Balances:      make(map[string]*big.Float),
		Signers:       signers,
		Threshold:     threshold,
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
	}
	
	s.accounts[account.ID] = account
	s.logAudit(account.ID, "ACCOUNT_CREATED", "system", "Account created")
	
	return account
}

func (s *CustodyService) GetAccount(accountID string) (*CustodyAccount, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	if acc, ok := s.accounts[accountID]; ok {
		return acc, nil
	}
	return nil, fmt.Errorf("account not found")
}

func (s *CustodyService) CreateTransaction(accountID, reqType, asset, destination, requestedBy string, amount *big.Float) (*TransactionRequest, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	// Verify account exists and is active
	account, ok := s.accounts[accountID]
	if !ok {
		return nil, fmt.Errorf("account not found")
	}
	if account.Status != "ACTIVE" {
		return nil, fmt.Errorf("account not active")
	}
	
	tx := &TransactionRequest{
		ID:          generateTxID(),
		AccountID:   accountID,
		Type:        reqType,
		Asset:       asset,
		Amount:      amount,
		Destination: destination,
		Status:      "PENDING",
		RequestedBy: requestedBy,
		ApprovedBy:  make([]string, 0),
		Signatures:  make(map[string]string),
		CreatedAt:  time.Now(),
	}
	
	s.transactions[tx.ID] = tx
	s.logAudit(accountID, "TX_CREATED", requestedBy, fmt.Sprintf("Transaction %s created for %s %s", tx.ID, amount.String(), asset))
	
	return tx, nil
}

func (s *CustodyService) ApproveTransaction(txID, approver, signature string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	tx, ok := s.transactions[txID]
	if !ok {
		return fmt.Errorf("transaction not found")
	}
	
	if tx.Status != "PENDING" {
		return fmt.Errorf("transaction not pending")
	}
	
	// Verify approver is authorized
	account, _ := s.accounts[tx.AccountID]
	if !isAuthorizedSigner(account, approver) {
		return fmt.Errorf("unauthorized approver")
	}
	
	// Add approval
	tx.ApprovedBy = append(tx.ApprovedBy, approver)
	tx.Signatures[approver] = signature
	
	// Check if threshold met
	if len(tx.ApprovedBy) >= account.Threshold {
		tx.Status = "APPROVED"
		s.logAudit(tx.AccountID, "TX_APPROVED", approver, fmt.Sprintf("Transaction %s approved", tx.ID))
	}
	
	return nil
}

func (s *CustodyService) ExecuteTransaction(txID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	tx, ok := s.transactions[txID]
	if !ok {
		return fmt.Errorf("transaction not found")
	}
	
	if tx.Status != "APPROVED" {
		return fmt.Errorf("transaction not approved")
	}
	
	// Execute transaction (in production, this would call blockchain)
	tx.Status = "EXECUTED"
	now := time.Now()
	tx.ExecutedAt = &now
	
	// Update balance
	account, _ := s.accounts[tx.AccountID]
	if current, ok := account.Balances[tx.Asset]; ok {
		newBalance := new(big.Float).Sub(current, tx.Amount)
		account.Balances[tx.Asset] = newBalance
	}
	
	s.logAudit(tx.AccountID, "TX_EXECUTED", "system", fmt.Sprintf("Transaction %s executed", tx.ID))
	
	return nil
}

func (s *CustodyService) SetPolicy(accountID string, policy *ApprovalPolicy) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	policy.ID = generatePolicyID()
	policy.AccountID = accountID
	s.policies[policy.ID] = policy
	
	s.logAudit(accountID, "POLICY_SET", "system", "Approval policy updated")
}

func (s *CustodyService) GetAuditLog(accountID string) []AuditRecord {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	var result []AuditRecord
	for _, record := range s.auditRecords {
		if record.AccountID == accountID {
			result = append(result, record)
		}
	}
	return result
}

func (s *CustodyService) FreezeAccount(accountID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	if account, ok := s.accounts[accountID]; ok {
		account.Status = "FROZEN"
		account.UpdatedAt = time.Now()
		s.logAudit(accountID, "ACCOUNT_FROZEN", "system", "Account frozen")
		return nil
	}
	return fmt.Errorf("account not found")
}

func (s *CustodyService) logAudit(accountID, action, actor, details string) {
	record := AuditRecord{
		ID:        generateAuditID(),
		AccountID: accountID,
		Action:    action,
		Actor:     actor,
		Details:   details,
		Timestamp: time.Now(),
	}
	s.auditRecords = append(s.auditRecords, record)
}

func isAuthorizedSigner(account *CustodyAccount, signer string) bool {
	for _, s := range account.Signers {
		if s == signer {
			return true
		}
	}
	return false
}

func generateCustodyID() string {
	h := sha256.Sum256([]byte(fmt.Sprintf("%d", time.Now().UnixNano())))
	return "CUSTODY-" + hex.EncodeToString(h[:8])
}

func generateTxID() string {
	h := sha256.Sum256([]byte(fmt.Sprintf("tx%d", time.Now().UnixNano())))
	return "TX-" + hex.EncodeToString(h[:8])
}

func generatePolicyID() string {
	h := sha256.Sum256([]byte(fmt.Sprintf("pol%d", time.Now().UnixNano())))
	return "POL-" + hex.EncodeToString(h[:8])
}

func generateAuditID() string {
	h := sha256.Sum256([]byte(fmt.Sprintf("aud%d", time.Now().UnixNano())))
	return "AUD-" + hex.EncodeToString(h[:8])
}

// =============================================================================
// MAIN
// =============================================================================

func main() {
	fmt.Println("TigerEx Institutional Custody Platform")
	fmt.Println("======================================")
	
	custody := NewCustodyService()
	
	// Create institutional account
	signers := []string{"signer1@inst.com", "signer2@inst.com", "signer3@inst.com"}
	account := custody.CreateAccount("INST001", "Hedge Fund A", "HEDGE_FUND", signers, 2)
	fmt.Printf("\nCreated Account: %s\n", account.Name)
	fmt.Printf("  Type: %s\n", account.Type)
	fmt.Printf("  Signers: %d\n", len(account.Signers))
	fmt.Printf("  Threshold: %d\n", account.Threshold)
	
	// Create transaction request
	tx, _ := custody.CreateTransaction(account.ID, "WITHDRAWAL", "BTC", "0xABC123", "signer1@inst.com", big.NewFloat(5.0))
	fmt.Printf("\nTransaction: %s\n", tx.ID)
	fmt.Printf("  Amount: %s BTC\n", tx.Amount.String())
	fmt.Printf("  Status: %s\n", tx.Status)
	
	// Approve transaction
	custody.ApproveTransaction(tx.ID, "signer1@inst.com", "sig1")
	custody.ApproveTransaction(tx.ID, "signer2@inst.com", "sig2")
	
	// Get updated transaction
	tx, _ = custody.transactions[tx.ID]
	fmt.Printf("  After Approval: %s\n", tx.Status)
	
	// Execute
	custody.ExecuteTransaction(tx.ID)
	tx, _ = custody.transactions[tx.ID]
	fmt.Printf("  After Execution: %s\n", tx.Status)
	
	// Audit log
	audit := custody.GetAuditLog(account.ID)
	fmt.Printf("\nAudit Log: %d records\n", len(audit))
	for _, r := range audit {
		fmt.Printf("  - [%s] %s: %s\n", r.Timestamp.Format("15:04"), r.Action, r.Details)
	}
}
