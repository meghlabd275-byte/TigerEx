// Package institutional provides institutional trading services
package institutional

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"tigerex-api/internal/api"
)

var (
	ErrNotFound = errors.New("not found")
	ErrUnauthorized = errors.New("unauthorized")
)

// Config holds institutional configuration
type Config struct {
	MinSubAccounts int
	MaxSubAccounts int
	MinAPIKeys int
	MaxAPIKeys int
}

// SubAccount represents a sub-account
type SubAccount struct {
	ID           string    `json:"id"`
	MasterID    string    `json:"masterId"`
	Name        string    `json:"name"`
	Email       string    `json:"email"`
	Status      string    `json:"status"` // "active", "suspended", "closed"
	Permissions []string  `json:"permissions"`
	TradingEnabled bool    `json:"tradingEnabled"`
	WithdrawalEnabled bool `json:"withdrawalEnabled"`
	CreatedAt   int64    `json:"createdAt"`
	UpdatedAt   int64    `json:"updatedAt"`
}

// SubAccountBalance represents sub-account balance
type SubAccountBalance struct {
	SubAccountID string          `json:"subAccountId"`
	Balances    map[string]float64 `json:"balances"`
	UpdatedAt   int64          `json:"updatedAt"`
}

// PermissionGroup represents a permission group
type PermissionGroup struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Permissions []string `json:"permissions"`
	CreatedAt   int64    `json:"createdAt"`
}

// MasterAccount represents a master trading account
type MasterAccount struct {
	ID             string    `json:"id"`
	UserID        string    `json:"userId"`
	Name          string    `json:"name"`
	AccountType   string    `json:"accountType"` // "master", "institutional"
	FeeTier      float64   `json:"feeTier"` // e.g., 0.001 for 0.1%
	MonthlyVolume float64   `json:"monthlyVolume"`
	Status       string    `json:"status"`
	CreatedAt    int64     `json:"createdAt"`
}

// OTCQuote represents an OTC quote
type OTCQuote struct {
	ID            string    `json:"id"`
	UserID       string    `json:"userId"`
	Asset        string    `json:"asset"`
	Side         string    `json:"side"` // "buy" or "sell"
	Amount       float64   `json:"amount"`
	QuotePrice   float64   `json:"quotePrice"`
	FinalPrice   float64   `json:"finalPrice"`
	Fee          float64   `json:"fee"`
	Status       string    `json:"status"` // "pending", "confirmed", "completed", "cancelled"
	ExpiresAt    int64     `json:"expiresAt"`
	CreatedAt    int64     `json:"createdAt"`
}

// CustodyAccount represents a custody account
type CustodyAccount struct {
	ID            string    `json:"id"`
	UserID       string    `json:"userId"`
	AccountName  string    `json:"accountName"`
	AccountType string    `json:"accountType"` // "hot", "cold", "institutional"
	Balance      float64   `json:"balance"`
	Network      string    `json:"network"`
	Status       string    `json:"status"`
	CreatedAt    int64     `json:"createdAt"`
}

// Service handles institutional operations
type Service struct {
	config          Config
	subAccounts    map[string]*SubAccount
	masterAccounts map[string]*MasterAccount
	permissionGroups map[string]*PermissionGroup
	otcQuotes     map[string]*OTCQuote
	custodyAccounts map[string]*CustodyAccount
}

func NewService(config Config) *Service {
	return &Service{
		config: config,
		subAccounts: make(map[string]*SubAccount),
		masterAccounts: make(map[string]*MasterAccount),
		permissionGroups: make(map[string]*PermissionGroup),
		otcQuotes: make(map[string]*OTCQuote),
		custodyAccounts: make(map[string]*CustodyAccount),
	}
}

// CreateSubAccount creates a new sub-account
func (s *Service) CreateSubAccount(ctx context.Context, masterID, name, email string, permissions []string) (*SubAccount, error) {
	sub := &SubAccount{
		ID: uuid.New().String(),
		MasterID: masterID,
		Name: name,
		Email: email,
		Status: "active",
		Permissions: permissions,
		TradingEnabled: true,
		WithdrawalEnabled: false,
		CreatedAt: api.Now(),
		UpdatedAt: api.Now(),
	}

	s.subAccounts[sub.ID] = sub
	return sub, nil
}

// GetSubAccount returns a sub-account
func (s *Service) GetSubAccount(masterID, subAccountID string) (*SubAccount, error) {
	sub, ok := s.subAccounts[subAccountID]
	if !ok {
		return nil, ErrNotFound
	}
	if sub.MasterID != masterID {
		return nil, ErrUnauthorized
	}
	return sub, nil
}

// GetSubAccounts returns all sub-accounts for a master
func (s *Service) GetSubAccounts(masterID string) []*SubAccount {
	result := make([]*SubAccount, 0)
	for _, sub := range s.subAccounts {
		if sub.MasterID == masterID {
			result = append(result, sub)
		}
	}
	return result
}

// UpdateSubAccount updates a sub-account
func (s *Service) UpdateSubAccount(masterID, subAccountID string, updates map[string]interface{}) (*SubAccount, error) {
	sub, err := s.GetSubAccount(masterID, subAccountID)
	if err != nil {
		return nil, err
	}

	if v, ok := updates["name"]; ok {
		sub.Name = v.(string)
	}
	if v, ok := updates["permissions"]; ok {
		sub.Permissions = v.([]string)
	}
	if v, ok := updates["tradingEnabled"]; ok {
		sub.TradingEnabled = v.(bool)
	}
	if v, ok := updates["withdrawalEnabled"]; ok {
		sub.WithdrawalEnabled = v.(bool)
	}
	if v, ok := updates["status"]; ok {
		sub.Status = v.(string)
	}

	sub.UpdatedAt = api.Now()
	return sub, nil
}

// DeleteSubAccount deletes a sub-account
func (s *Service) DeleteSubAccount(masterID, subAccountID string) error {
	sub, err := s.GetSubAccount(masterID, subAccountID)
	if err != nil {
		return err
	}
	sub.Status = "closed"
	sub.UpdatedAt = api.Now()
	return nil
}

// TransferBetweenSubAccounts transfers between sub-accounts
func (s *Service) TransferBetweenSubAccounts(masterID, fromID, toID, asset string, amount float64) error {
	from, err := s.GetSubAccount(masterID, fromID)
	if err != nil {
		return err
	}
	to, err := s.GetSubAccount(masterID, toID)
	if err != nil {
		return err
	}

	if !from.TradingEnabled || !to.TradingEnabled {
		return errors.New("trading not enabled for one or both accounts")
	}

	// In production, would update balances
	_ = amount
	_ = asset

	return nil
}

// CreateMasterAccount creates a master account
func (s *Service) CreateMasterAccount(ctx context.Context, userID, name, accountType string, feeTier float64) (*MasterAccount, error) {
	account := &MasterAccount{
		ID: uuid.New().String(),
		UserID: userID,
		Name: name,
		AccountType: accountType,
		FeeTier: feeTier,
		MonthlyVolume: 0,
		Status: "active",
		CreatedAt: api.Now(),
	}

	s.masterAccounts[account.ID] = account
	return account, nil
}

// GetMasterAccount returns a master account
func (s *Service) GetMasterAccount(userID, accountID string) (*MasterAccount, error) {
	account, ok := s.masterAccounts[accountID]
	if !ok {
		return nil, ErrNotFound
	}
	if account.UserID != userID {
		return nil, ErrUnauthorized
	}
	return account, nil
}

// UpdateFeeTier updates the fee tier based on volume
func (s *Service) UpdateFeeTier(accountID string, monthlyVolume float64) error {
	account, ok := s.masterAccounts[accountID]
	if !ok {
		return ErrNotFound
	}

	// Tiered fee structure
	switch {
	case monthlyVolume >= 100000000: // $100M+
		account.FeeTier = 0.0
	case monthlyVolume >= 50000000: // $50M+
		account.FeeTier = 0.0005
	case monthlyVolume >= 10000000: // $10M+
		account.FeeTier = 0.001
	case monthlyVolume >= 1000000: // $1M+
		account.FeeTier = 0.002
	default:
		account.FeeTier = 0.005
	}

	account.MonthlyVolume = monthlyVolume
	return nil
}

// CreatePermissionGroup creates a permission group
func (s *Service) CreatePermissionGroup(name, description string, permissions []string) (*PermissionGroup, error) {
	group := &PermissionGroup{
		ID: uuid.New().String(),
		Name: name,
		Description: description,
		Permissions: permissions,
		CreatedAt: api.Now(),
	}

	s.permissionGroups[group.ID] = group
	return group, nil
}

// GetPermissionGroups returns all permission groups
func (s *Service) GetPermissionGroups() []*PermissionGroup {
	result := make([]*PermissionGroup, 0, len(s.permissionGroups))
	for _, g := range s.permissionGroups {
		result = append(result, g)
	}
	return result
}

// AssignPermissionGroup assigns a permission group to a sub-account
func (s *Service) AssignPermissionGroup(masterID, subAccountID, groupID string) error {
	group, ok := s.permissionGroups[groupID]
	if !ok {
		return ErrNotFound
	}

	sub, err := s.GetSubAccount(masterID, subAccountID)
	if err != nil {
		return err
	}

	sub.Permissions = group.Permissions
	sub.UpdatedAt = api.Now()

	return nil
}

// RequestOTCQuote requests an OTC quote
func (s *Service) RequestOTCQuote(ctx context.Context, userID, asset, side string, amount float64) (*OTCQuote, error) {
	// Get market price (in production, would fetch from market)
	marketPrice := 45000.0 // placeholder

	// Apply OTC discount
	discount := 0.002 // 0.2% discount for large trades
	if amount > 100000 {
		discount = 0.005 // 0.5% for very large
	}

	var quotePrice float64
	if side == "buy" {
		quotePrice = marketPrice * (1 - discount)
	} else {
		quotePrice = marketPrice * (1 + discount)
	}

	fee := amount * quotePrice * 0.001 // 0.1% fee

	quote := &OTCQuote{
		ID: uuid.New().String(),
		UserID: userID,
		Asset: asset,
		Side: side,
		Amount: amount,
		QuotePrice: quotePrice,
		FinalPrice: 0,
		Fee: fee,
		Status: "pending",
		ExpiresAt: api.Now() + 300, // 5 minutes
		CreatedAt: api.Now(),
	}

	s.otcQuotes[quote.ID] = quote
	return quote, nil
}

// ConfirmOTCQuote confirms an OTC quote
func (s *Service) ConfirmOTCQuote(userID, quoteID string) error {
	quote, ok := s.otcQuotes[quoteID]
	if !ok {
		return ErrNotFound
	}
	if quote.UserID != userID {
		return ErrUnauthorized
	}
	if quote.Status != "pending" {
		return errors.New("quote not pending")
	}
	if api.Now() > quote.ExpiresAt {
		return errors.New("quote expired")
	}

	quote.Status = "confirmed"
	return nil
}

// ExecuteOTC executes an OTC trade
func (s *Service) ExecuteOTC(userID, quoteID string) (*OTCQuote, error) {
	quote, ok := s.otcQuotes[quoteID]
	if !ok {
		return nil, ErrNotFound
	}
	if quote.UserID != userID {
		return nil, ErrUnauthorized
	}
	if quote.Status != "confirmed" {
		return nil, errors.New("quote not confirmed")
	}

	quote.Status = "completed"
	quote.FinalPrice = quote.QuotePrice
	return quote, nil
}

// CreateCustodyAccount creates a custody account
func (s *Service) CreateCustodyAccount(ctx context.Context, userID, accountName, accountType, network string) (*CustodyAccount, error) {
	account := &CustodyAccount{
		ID: uuid.New().String(),
		UserID: userID,
		AccountName: accountName,
		AccountType: accountType,
		Balance: 0,
		Network: network,
		Status: "active",
		CreatedAt: api.Now(),
	}

	s.custodyAccounts[account.ID] = account
	return account, nil
}

// GetCustodyAccount returns a custody account
func (s *Service) GetCustodyAccount(userID, accountID string) (*CustodyAccount, error) {
	account, ok := s.custodyAccounts[accountID]
	if !ok {
		return nil, ErrNotFound
	}
	if account.UserID != userID {
		return nil, ErrUnauthorized
	}
	return account, nil
}

// GetCustodyAccounts returns all custody accounts for a user
func (s *Service) GetCustodyAccounts(userID string) []*CustodyAccount {
	result := make([]*CustodyAccount, 0)
	for _, a := range s.custodyAccounts {
		if a.UserID == userID {
			result = append(result, a)
		}
	}
	return result
}

// TransferToCustody transfers to custody account
func (s *Service) TransferToCustody(userID, fromAccountID, toAccountID string, amount float64) error {
	from, err := s.GetCustodyAccount(userID, fromAccountID)
	if err != nil {
		return err
	}
	to, err := s.GetCustodyAccount(userID, toAccountID)
	if err != nil {
		return err
	}

	if from.Balance < amount {
		return errors.New("insufficient balance")
	}

	from.Balance -= amount
	to.Balance += amount

	return nil
}

// DedicatedAccountManager represents a dedicated account manager
type DedicatedAccountManager struct {
	ID          string `json:"id"`
	UserID     string `json:"userId"`
	Name       string `json:"name"`
	Email      string `json:"email"`
	Phone      string `json:"phone"`
	Language   string `json:"language"`
	Timezone   string `json:"timezone"`
	AssignedAt int64  `json:"assignedAt"`
}

// AssignAccountManager assigns a dedicated account manager
func (s *Service) AssignAccountManager(userID, managerID string) (*DedicatedAccountManager, error) {
	// In production, would integrate with CRM
	manager := &DedicatedAccountManager{
		ID: managerID,
		UserID: userID,
		Name: "John Doe",
		Email: "john.doe@tigerex.com",
		Phone: "+1-555-0123",
		Language: "en",
		Timezone: "America/New_York",
		AssignedAt: api.Now(),
	}

	return manager, nil
}

// AuditLog represents an audit log entry
type AuditLog struct {
	ID           string    `json:"id"`
	UserID       string    `json:"userId"`
	Action       string    `json:"action"`
	ResourceType string    `json:"resourceType"`
	ResourceID  string    `json:"resourceId"`
	IPAddress   string    `json:"ipAddress"`
	UserAgent   string    `json:"userAgent"`
	Details     string    `json:"details"`
	Timestamp   int64     `json:"timestamp"`
}

// LogAction logs an action for audit
func (s *Service) LogAction(userID, action, resourceType, resourceID, ipAddress, userAgent, details string) *AuditLog {
	log := &AuditLog{
		ID: uuid.New().String(),
		UserID: userID,
		Action: action,
		ResourceType: resourceType,
		ResourceID: resourceID,
		IPAddress: ipAddress,
		UserAgent: userAgent,
		Details: details,
		Timestamp: api.Now(),
	}

	// In production, would persist to database
	return log
}

// GetAuditLogs returns audit logs for a user
func (s *Service) GetAuditLogs(userID string, limit int) []*AuditLog {
	// In production, would query database
	return make([]*AuditLog, 0)
}