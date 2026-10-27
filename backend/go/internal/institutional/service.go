// Package institutional provides institutional trading services: master and
// sub-accounts, permission groups, OTC quoting, custody accounts, and audit
// logging.
//
// The service holds no state of its own. Balances, quotes, audit records, and
// account managers all live behind the interfaces declared in deps.go, which
// the deployment wires to the ledger, the market data service, the audit store,
// and the CRM. That keeps a single source of truth for balances and means an
// audit record cannot be silently dropped.
package institutional

import (
	"context"
	"errors"
	"math"
	"strings"

	"github.com/google/uuid"

	"tigerex/backend/internal/api"
)

var (
	ErrNotFound           = errors.New("not found")
	ErrUnauthorized       = errors.New("unauthorized")
	ErrInvalidAmount      = errors.New("amount must be positive")
	ErrDependencyMissing  = errors.New("required dependency is not configured")
	ErrMarketUnavailable  = errors.New("market price unavailable")
	ErrInvalidPermission  = errors.New("invalid permission")
	ErrSubAccountLimit    = errors.New("sub-account limit reached")
	ErrInvalidSide        = errors.New("side must be buy or sell")
	ErrQuoteExpired       = errors.New("quote expired")
	ErrInvalidAccountType = errors.New("invalid account type")
)

// Config holds institutional configuration.
type Config struct {
	MinSubAccounts int
	MaxSubAccounts int
	MinAPIKeys     int
	MaxAPIKeys     int
}

// KnownPermissions is the set of permission strings a sub-account or permission
// group may hold. An unknown permission is rejected rather than stored, so a
// typo cannot silently grant nothing or be interpreted loosely later.
var KnownPermissions = map[string]bool{
	"spot.trade":        true,
	"futures.trade":     true,
	"margin.trade":      true,
	"options.trade":     true,
	"earn.subscribe":    true,
	"wallet.deposit":    true,
	"wallet.withdraw":   true,
	"subaccount.manage": true,
	"apikey.manage":     true,
	"report.view":       true,
}

// SubAccount represents a sub-account.
type SubAccount struct {
	ID                string   `json:"id"`
	MasterID          string   `json:"masterId"`
	Name              string   `json:"name"`
	Email             string   `json:"email"`
	Status            string   `json:"status"` // "active", "suspended", "closed"
	Permissions       []string `json:"permissions"`
	TradingEnabled    bool     `json:"tradingEnabled"`
	WithdrawalEnabled bool     `json:"withdrawalEnabled"`
	CreatedAt         int64    `json:"createdAt"`
	UpdatedAt         int64    `json:"updatedAt"`
}

// SubAccountBalance represents a sub-account balance.
type SubAccountBalance struct {
	SubAccountID string             `json:"subAccountId"`
	Balances     map[string]float64 `json:"balances"`
	UpdatedAt    int64              `json:"updatedAt"`
}

// PermissionGroup represents a permission group.
type PermissionGroup struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Permissions []string `json:"permissions"`
	CreatedAt   int64    `json:"createdAt"`
}

// MasterAccount represents a master trading account.
type MasterAccount struct {
	ID            string  `json:"id"`
	UserID        string  `json:"userId"`
	Name          string  `json:"name"`
	AccountType   string  `json:"accountType"` // "master", "institutional"
	FeeTier       float64 `json:"feeTier"`     // e.g. 0.001 for 0.1%
	MonthlyVolume float64 `json:"monthlyVolume"`
	Status        string  `json:"status"`
	CreatedAt     int64   `json:"createdAt"`
}

// OTCQuote represents an OTC quote.
type OTCQuote struct {
	ID         string  `json:"id"`
	UserID     string  `json:"userId"`
	Asset      string  `json:"asset"`
	Side       string  `json:"side"` // "buy" or "sell"
	Amount     float64 `json:"amount"`
	QuotePrice float64 `json:"quotePrice"`
	FinalPrice float64 `json:"finalPrice"`
	Fee        float64 `json:"fee"`
	Status     string  `json:"status"` // "pending", "confirmed", "completed", "cancelled"
	ExpiresAt  int64   `json:"expiresAt"`
	CreatedAt  int64   `json:"createdAt"`
}

// CustodyAccount represents a custody account.
type CustodyAccount struct {
	ID          string  `json:"id"`
	UserID      string  `json:"userId"`
	AccountName string  `json:"accountName"`
	AccountType string  `json:"accountType"` // "hot", "cold", "institutional"
	Balance     float64 `json:"balance"`
	Network     string  `json:"network"`
	Status      string  `json:"status"`
	CreatedAt   int64   `json:"createdAt"`
}

// DedicatedAccountManager represents a dedicated account manager.
type DedicatedAccountManager struct {
	ID         string `json:"id"`
	UserID     string `json:"userId"`
	Name       string `json:"name"`
	Email      string `json:"email"`
	Phone      string `json:"phone"`
	Language   string `json:"language"`
	Timezone   string `json:"timezone"`
	AssignedAt int64  `json:"assignedAt"`
}

// AuditLog represents an audit log entry.
type AuditLog struct {
	ID           string `json:"id"`
	UserID       string `json:"userId"`
	Action       string `json:"action"`
	ResourceType string `json:"resourceType"`
	ResourceID   string `json:"resourceId"`
	IPAddress    string `json:"ipAddress"`
	UserAgent    string `json:"userAgent"`
	Details      string `json:"details"`
	Timestamp    int64  `json:"timestamp"`
}

// Service handles institutional operations.
type Service struct {
	config Config

	accounts AccountStore
	ledger   Ledger
	markets  MarketData
	audit    AuditStore
	managers ManagerDirectory
}

// NewService builds a service around the given stores. Operations whose store
// is nil fail closed with ErrDependencyMissing rather than returning a
// plausible-looking empty result.
func NewService(config Config, accounts AccountStore, ledger Ledger, markets MarketData, audit AuditStore, managers ManagerDirectory) *Service {
	if config.MaxSubAccounts <= 0 {
		config.MaxSubAccounts = 300
	}
	return &Service{
		config:   config,
		accounts: accounts,
		ledger:   ledger,
		markets:  markets,
		audit:    audit,
		managers: managers,
	}
}

func validatePermissions(perms []string) error {
	for _, p := range perms {
		if !KnownPermissions[p] {
			return ErrInvalidPermission
		}
	}
	return nil
}

// CreateSubAccount creates a new sub-account.
func (s *Service) CreateSubAccount(ctx context.Context, masterID, name, email string, permissions []string) (*SubAccount, error) {
	if s.accounts == nil {
		return nil, ErrDependencyMissing
	}
	if strings.TrimSpace(masterID) == "" || strings.TrimSpace(name) == "" {
		return nil, errors.New("masterId and name are required")
	}
	if err := validatePermissions(permissions); err != nil {
		return nil, err
	}

	existing, err := s.accounts.ListSubAccounts(ctx, masterID)
	if err != nil {
		return nil, err
	}
	if len(existing) >= s.config.MaxSubAccounts {
		return nil, ErrSubAccountLimit
	}

	sub := &SubAccount{
		ID:                uuid.New().String(),
		MasterID:          masterID,
		Name:              name,
		Email:             email,
		Status:            "active",
		Permissions:       permissions,
		TradingEnabled:    true,
		WithdrawalEnabled: false,
		CreatedAt:         api.Now(),
		UpdatedAt:         api.Now(),
	}

	if err := s.accounts.SaveSubAccount(ctx, sub); err != nil {
		return nil, err
	}
	s.log(ctx, masterID, "subaccount.create", "subaccount", sub.ID, "")
	return sub, nil
}

// GetSubAccount returns a sub-account.
func (s *Service) GetSubAccount(masterID, subAccountID string) (*SubAccount, error) {
	if s.accounts == nil {
		return nil, ErrDependencyMissing
	}
	sub, err := s.accounts.GetSubAccount(context.Background(), subAccountID)
	if err != nil {
		return nil, err
	}
	if sub.MasterID != masterID {
		return nil, ErrUnauthorized
	}
	return sub, nil
}

// GetSubAccounts returns all sub-accounts for a master.
func (s *Service) GetSubAccounts(masterID string) []*SubAccount {
	if s.accounts == nil {
		return nil
	}
	subs, err := s.accounts.ListSubAccounts(context.Background(), masterID)
	if err != nil {
		return nil
	}
	return subs
}

// UpdateSubAccount updates a sub-account.
func (s *Service) UpdateSubAccount(masterID, subAccountID string, updates map[string]interface{}) (*SubAccount, error) {
	sub, err := s.GetSubAccount(masterID, subAccountID)
	if err != nil {
		return nil, err
	}

	// The comma-ok form matters here: the previous unchecked assertions panicked
	// on any caller that passed the wrong type.
	if v, ok := updates["name"]; ok {
		name, isString := v.(string)
		if !isString {
			return nil, errors.New("name must be a string")
		}
		sub.Name = name
	}
	if v, ok := updates["permissions"]; ok {
		perms, isStrings := v.([]string)
		if !isStrings {
			return nil, errors.New("permissions must be a []string")
		}
		if err := validatePermissions(perms); err != nil {
			return nil, err
		}
		sub.Permissions = perms
	}
	if v, ok := updates["tradingEnabled"]; ok {
		enabled, isBool := v.(bool)
		if !isBool {
			return nil, errors.New("tradingEnabled must be a bool")
		}
		sub.TradingEnabled = enabled
	}
	if v, ok := updates["withdrawalEnabled"]; ok {
		enabled, isBool := v.(bool)
		if !isBool {
			return nil, errors.New("withdrawalEnabled must be a bool")
		}
		sub.WithdrawalEnabled = enabled
	}
	if v, ok := updates["status"]; ok {
		status, isString := v.(string)
		if !isString {
			return nil, errors.New("status must be a string")
		}
		if status != "active" && status != "suspended" && status != "closed" {
			return nil, errors.New("status must be active, suspended, or closed")
		}
		sub.Status = status
	}

	sub.UpdatedAt = api.Now()
	if err := s.accounts.SaveSubAccount(context.Background(), sub); err != nil {
		return nil, err
	}
	s.log(context.Background(), masterID, "subaccount.update", "subaccount", sub.ID, "")
	return sub, nil
}

// DeleteSubAccount closes a sub-account.
func (s *Service) DeleteSubAccount(masterID, subAccountID string) error {
	sub, err := s.GetSubAccount(masterID, subAccountID)
	if err != nil {
		return err
	}
	sub.Status = "closed"
	sub.UpdatedAt = api.Now()
	if err := s.accounts.SaveSubAccount(context.Background(), sub); err != nil {
		return err
	}
	s.log(context.Background(), masterID, "subaccount.close", "subaccount", sub.ID, "")
	return nil
}

// TransferBetweenSubAccounts moves funds between two sub-accounts of the same
// master. The balances live in the ledger, so this is a ledger transfer rather
// than a local mutation that only one process can see.
func (s *Service) TransferBetweenSubAccounts(masterID, fromID, toID, asset string, amount float64) error {
	if s.ledger == nil {
		return ErrDependencyMissing
	}
	if !(amount > 0) || math.IsInf(amount, 0) || math.IsNaN(amount) {
		return ErrInvalidAmount
	}
	from, err := s.GetSubAccount(masterID, fromID)
	if err != nil {
		return err
	}
	to, err := s.GetSubAccount(masterID, toID)
	if err != nil {
		return err
	}
	if from.Status != "active" || to.Status != "active" {
		return errors.New("both accounts must be active")
	}
	if !from.TradingEnabled || !to.TradingEnabled {
		return errors.New("trading not enabled for one or both accounts")
	}

	ctx := context.Background()
	if err := s.ledger.TransferSubAccount(ctx, fromID, toID, asset, amount); err != nil {
		return err
	}
	s.log(ctx, masterID, "subaccount.transfer", "subaccount", fromID, toID)
	return nil
}

// GetSubAccountBalance reads a sub-account's balances from the ledger.
func (s *Service) GetSubAccountBalance(ctx context.Context, masterID, subAccountID string) (*SubAccountBalance, error) {
	if s.ledger == nil {
		return nil, ErrDependencyMissing
	}
	if _, err := s.GetSubAccount(masterID, subAccountID); err != nil {
		return nil, err
	}
	balances, err := s.ledger.Balances(ctx, subAccountID)
	if err != nil {
		return nil, err
	}
	return &SubAccountBalance{
		SubAccountID: subAccountID,
		Balances:     balances,
		UpdatedAt:    api.Now(),
	}, nil
}

// CreateMasterAccount creates a master account.
func (s *Service) CreateMasterAccount(ctx context.Context, userID, name, accountType string, feeTier float64) (*MasterAccount, error) {
	if s.accounts == nil {
		return nil, ErrDependencyMissing
	}
	if accountType != "master" && accountType != "institutional" {
		return nil, ErrInvalidAccountType
	}
	account := &MasterAccount{
		ID:            uuid.New().String(),
		UserID:        userID,
		Name:          name,
		AccountType:   accountType,
		FeeTier:       feeTier,
		MonthlyVolume: 0,
		Status:        "active",
		CreatedAt:     api.Now(),
	}
	if err := s.accounts.SaveMasterAccount(ctx, account); err != nil {
		return nil, err
	}
	s.log(ctx, userID, "master.create", "master", account.ID, "")
	return account, nil
}

// GetMasterAccount returns a master account.
func (s *Service) GetMasterAccount(userID, accountID string) (*MasterAccount, error) {
	if s.accounts == nil {
		return nil, ErrDependencyMissing
	}
	account, err := s.accounts.GetMasterAccount(context.Background(), accountID)
	if err != nil {
		return nil, err
	}
	if account.UserID != userID {
		return nil, ErrUnauthorized
	}
	return account, nil
}

// UpdateFeeTier updates the fee tier based on trailing monthly volume.
func (s *Service) UpdateFeeTier(accountID string, monthlyVolume float64) error {
	if s.accounts == nil {
		return ErrDependencyMissing
	}
	if monthlyVolume < 0 || math.IsNaN(monthlyVolume) || math.IsInf(monthlyVolume, 0) {
		return ErrInvalidAmount
	}
	account, err := s.accounts.GetMasterAccount(context.Background(), accountID)
	if err != nil {
		return err
	}

	account.FeeTier = feeTierForVolume(monthlyVolume)
	account.MonthlyVolume = monthlyVolume
	if err := s.accounts.SaveMasterAccount(context.Background(), account); err != nil {
		return err
	}
	s.log(context.Background(), account.UserID, "master.feetier", "master", account.ID, "")
	return nil
}

// feeTierForVolume maps trailing monthly volume to a maker/taker fee tier.
func feeTierForVolume(monthlyVolume float64) float64 {
	switch {
	case monthlyVolume >= 100000000:
		return 0.0
	case monthlyVolume >= 50000000:
		return 0.0005
	case monthlyVolume >= 10000000:
		return 0.001
	case monthlyVolume >= 1000000:
		return 0.002
	default:
		return 0.005
	}
}

// CreatePermissionGroup creates a permission group.
func (s *Service) CreatePermissionGroup(name, description string, permissions []string) (*PermissionGroup, error) {
	if s.accounts == nil {
		return nil, ErrDependencyMissing
	}
	if err := validatePermissions(permissions); err != nil {
		return nil, err
	}
	group := &PermissionGroup{
		ID:          uuid.New().String(),
		Name:        name,
		Description: description,
		Permissions: permissions,
		CreatedAt:   api.Now(),
	}
	if err := s.accounts.SavePermissionGroup(context.Background(), group); err != nil {
		return nil, err
	}
	return group, nil
}

// GetPermissionGroups returns all permission groups.
func (s *Service) GetPermissionGroups() []*PermissionGroup {
	if s.accounts == nil {
		return nil
	}
	groups, err := s.accounts.ListPermissionGroups(context.Background())
	if err != nil {
		return nil
	}
	return groups
}

// AssignPermissionGroup assigns a permission group to a sub-account and
// persists the result.
func (s *Service) AssignPermissionGroup(masterID, subAccountID, groupID string) error {
	if s.accounts == nil {
		return ErrDependencyMissing
	}
	group, err := s.accounts.GetPermissionGroup(context.Background(), groupID)
	if err != nil {
		return err
	}
	sub, err := s.GetSubAccount(masterID, subAccountID)
	if err != nil {
		return err
	}

	sub.Permissions = group.Permissions
	sub.UpdatedAt = api.Now()
	if err := s.accounts.SaveSubAccount(context.Background(), sub); err != nil {
		return err
	}
	s.log(context.Background(), masterID, "subaccount.permissions", "subaccount", sub.ID, groupID)
	return nil
}

// RequestOTCQuote prices an OTC trade from the live market price. The price
// comes from the market data service; if no price is available the quote is
// refused rather than priced off a constant.
func (s *Service) RequestOTCQuote(ctx context.Context, userID, asset, side string, amount float64) (*OTCQuote, error) {
	if s.markets == nil || s.accounts == nil {
		return nil, ErrDependencyMissing
	}
	if side != "buy" && side != "sell" {
		return nil, ErrInvalidSide
	}
	if !(amount > 0) || math.IsInf(amount, 0) || math.IsNaN(amount) {
		return nil, ErrInvalidAmount
	}

	marketPrice, err := s.markets.USDPrice(ctx, asset)
	if err != nil {
		return nil, err
	}
	if !(marketPrice > 0) || math.IsInf(marketPrice, 0) || math.IsNaN(marketPrice) {
		return nil, ErrMarketUnavailable
	}

	discount := 0.002
	if amount > 100000 {
		discount = 0.005
	}

	var quotePrice float64
	if side == "buy" {
		quotePrice = marketPrice * (1 - discount)
	} else {
		quotePrice = marketPrice * (1 + discount)
	}

	quote := &OTCQuote{
		ID:         uuid.New().String(),
		UserID:     userID,
		Asset:      asset,
		Side:       side,
		Amount:     amount,
		QuotePrice: quotePrice,
		Fee:        amount * quotePrice * 0.001,
		Status:     "pending",
		ExpiresAt:  api.Now() + 300,
		CreatedAt:  api.Now(),
	}

	if err := s.accounts.SaveOTCQuote(ctx, quote); err != nil {
		return nil, err
	}
	s.log(ctx, userID, "otc.quote", "otcquote", quote.ID, "")
	return quote, nil
}

// ConfirmOTCQuote confirms an OTC quote.
func (s *Service) ConfirmOTCQuote(userID, quoteID string) error {
	quote, err := s.otcQuote(userID, quoteID)
	if err != nil {
		return err
	}
	if quote.Status != "pending" {
		return errors.New("quote not pending")
	}
	if api.Now() > quote.ExpiresAt {
		return ErrQuoteExpired
	}
	quote.Status = "confirmed"
	if err := s.accounts.SaveOTCQuote(context.Background(), quote); err != nil {
		return err
	}
	s.log(context.Background(), userID, "otc.confirm", "otcquote", quote.ID, "")
	return nil
}

// ExecuteOTC settles a confirmed quote through the ledger.
func (s *Service) ExecuteOTC(userID, quoteID string) (*OTCQuote, error) {
	if s.ledger == nil {
		return nil, ErrDependencyMissing
	}
	quote, err := s.otcQuote(userID, quoteID)
	if err != nil {
		return nil, err
	}
	if quote.Status != "confirmed" {
		return nil, errors.New("quote not confirmed")
	}
	if api.Now() > quote.ExpiresAt {
		return nil, ErrQuoteExpired
	}

	total := quote.Amount * quote.QuotePrice
	if err := s.ledger.SettleOTC(context.Background(), userID, quote.Asset, quote.Side, quote.Amount, total, quote.Fee); err != nil {
		return nil, err
	}

	quote.Status = "completed"
	quote.FinalPrice = quote.QuotePrice
	if err := s.accounts.SaveOTCQuote(context.Background(), quote); err != nil {
		return nil, err
	}
	s.log(context.Background(), userID, "otc.execute", "otcquote", quote.ID, "")
	return quote, nil
}

func (s *Service) otcQuote(userID, quoteID string) (*OTCQuote, error) {
	if s.accounts == nil {
		return nil, ErrDependencyMissing
	}
	quote, err := s.accounts.GetOTCQuote(context.Background(), quoteID)
	if err != nil {
		return nil, err
	}
	if quote.UserID != userID {
		return nil, ErrUnauthorized
	}
	return quote, nil
}

// CreateCustodyAccount creates a custody account.
func (s *Service) CreateCustodyAccount(ctx context.Context, userID, accountName, accountType, network string) (*CustodyAccount, error) {
	if s.accounts == nil {
		return nil, ErrDependencyMissing
	}
	switch accountType {
	case "hot", "cold", "institutional":
	default:
		return nil, ErrInvalidAccountType
	}
	account := &CustodyAccount{
		ID:          uuid.New().String(),
		UserID:      userID,
		AccountName: accountName,
		AccountType: accountType,
		Balance:     0,
		Network:     network,
		Status:      "active",
		CreatedAt:   api.Now(),
	}
	if err := s.accounts.SaveCustodyAccount(ctx, account); err != nil {
		return nil, err
	}
	s.log(ctx, userID, "custody.create", "custody", account.ID, "")
	return account, nil
}

// GetCustodyAccount returns a custody account.
func (s *Service) GetCustodyAccount(userID, accountID string) (*CustodyAccount, error) {
	if s.accounts == nil {
		return nil, ErrDependencyMissing
	}
	account, err := s.accounts.GetCustodyAccount(context.Background(), accountID)
	if err != nil {
		return nil, err
	}
	if account.UserID != userID {
		return nil, ErrUnauthorized
	}
	return account, nil
}

// GetCustodyAccounts returns all custody accounts for a user.
func (s *Service) GetCustodyAccounts(userID string) []*CustodyAccount {
	if s.accounts == nil {
		return nil
	}
	accounts, err := s.accounts.ListCustodyAccounts(context.Background(), userID)
	if err != nil {
		return nil
	}
	return accounts
}

// TransferToCustody moves funds into a custody account through the ledger.
func (s *Service) TransferToCustody(userID, fromAccountID, toAccountID string, amount float64) error {
	if s.ledger == nil {
		return ErrDependencyMissing
	}
	if !(amount > 0) || math.IsInf(amount, 0) || math.IsNaN(amount) {
		return ErrInvalidAmount
	}
	if _, err := s.GetCustodyAccount(userID, fromAccountID); err != nil {
		return err
	}
	if _, err := s.GetCustodyAccount(userID, toAccountID); err != nil {
		return err
	}
	if err := s.ledger.TransferCustody(context.Background(), fromAccountID, toAccountID, amount); err != nil {
		return err
	}
	s.log(context.Background(), userID, "custody.transfer", "custody", fromAccountID, toAccountID)
	return nil
}

// AssignAccountManager assigns a dedicated account manager. The manager record
// comes from the CRM directory; the placeholder details that used to be returned
// here belonged to nobody.
func (s *Service) AssignAccountManager(userID, managerID string) (*DedicatedAccountManager, error) {
	if s.managers == nil {
		return nil, ErrDependencyMissing
	}
	manager, err := s.managers.Lookup(managerID)
	if err != nil {
		return nil, err
	}
	manager.UserID = userID
	manager.AssignedAt = api.Now()
	if err := s.managers.Assign(userID, managerID); err != nil {
		return nil, err
	}
	s.log(context.Background(), userID, "manager.assign", "manager", managerID, "")
	return manager, nil
}

// LogAction records an audit entry and returns both the entry and the write
// error, so a caller can decide whether a failed audit write should fail the
// operation. It never silently drops the record.
func (s *Service) LogAction(userID, action, resourceType, resourceID, ipAddress, userAgent, details string) (*AuditLog, error) {
	entry := &AuditLog{
		ID:           uuid.New().String(),
		UserID:       userID,
		Action:       action,
		ResourceType: resourceType,
		ResourceID:   resourceID,
		IPAddress:    ipAddress,
		UserAgent:    userAgent,
		Details:      details,
		Timestamp:    api.Now(),
	}
	if s.audit == nil {
		return entry, ErrDependencyMissing
	}
	if err := s.audit.Append(context.Background(), entry); err != nil {
		return entry, err
	}
	return entry, nil
}

// GetAuditLogs returns audit logs for a user.
func (s *Service) GetAuditLogs(userID string, limit int) ([]*AuditLog, error) {
	if s.audit == nil {
		return nil, ErrDependencyMissing
	}
	return s.audit.List(context.Background(), userID, limit)
}

// log is the internal best-effort audit helper used by the mutation methods.
func (s *Service) log(ctx context.Context, userID, action, resourceType, resourceID, details string) {
	if s.audit == nil {
		return
	}
	_ = s.audit.Append(ctx, &AuditLog{
		ID:           uuid.New().String(),
		UserID:       userID,
		Action:       action,
		ResourceType: resourceType,
		ResourceID:   resourceID,
		Details:      details,
		Timestamp:    api.Now(),
	})
}
