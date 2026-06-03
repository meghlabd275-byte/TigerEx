// Package panel provides admin dashboard and backoffice functionality.
package panel

import (
	"context"
	"database/sql"
	"fmt"
	"sync"
	"time"
)

// Role represents admin role
type Role string

const (
	RoleSuperAdmin  Role = "SUPER_ADMIN"
	RoleAdmin      Role = "ADMIN"
	RoleCompliance Role = "COMPLIANCE"
	RoleSupport    Role = "SUPPORT"
	RoleFinance    Role = "FINANCE"
)

// Permission represents permission type
type Permission string

const (
	PermUsers      Permission = "USERS"
	PermKYC       Permission = "KYC"
	PermTrading   Permission = "TRADING"
	PermWallets  Permission = "WALLETS"
	PermFees     Permission = "FEES"
	PermMarkets  Permission = "MARKETS"
	PermReports  Permission = "REPORTS"
	PermSettings Permission = "SETTINGS"
	PermAudit    Permission = "AUDIT"
)

// AdminUser represents admin user
type AdminUser struct {
	ID            string     `json:"id" db:"id"`
	Email         string     `json:"email" db:"email"`
	Username     string     `json:"username" db:"username"`
	Role         Role       `json:"role" db:"role"`
	Permissions []Permission `json:"permissions" db:"-"`
	Status       string     `json:"status" db:"status"`
	LastLogin    *time.Time `json:"last_login" db:"-"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time `json:"updated_at" db:"updated_at"`
}

// AuditLog represents audit log entry
type AuditLog struct {
	ID        string    `json:"id" db:"id"`
	UserID   string    `json:"user_id" db:"user_id"`
	Action   string    `json:"action" db:"action"`
	Resource  string   `json:"resource" db:"resource"`
	Details  string    `json:"details" db:"details"`
	IPAddress string   `json:"ip_address" db:"ip_address"`
	UserAgent string   `json:"user_agent" db:"user_agent"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

// DashboardStats represents dashboard statistics
type DashboardStats struct {
	TotalUsers     int64   `json:"total_users"`
	ActiveUsers   int64   `json:"active_users"`
	NewUsersToday int64   `json:"new_users_today"`
	VerifyPending int64   `json:"verify_pending"`
	VerifyApproved int64  `json:"verify_approved"`
	TotalVolume  string  `json:"total_volume"`
	TodayVolume  string  `json:"today_volume"`
	OpenTickets  int64   `json:"open_tickets"`
}

// MarketStats represents market statistics
type MarketStats struct {
	Symbol         string  `json:"symbol"`
	Price         string  `json:"price"`
	Change24h     string  `json:"change_24h"`
	Volume24h     string  `json:"volume_24h"`
	Trades24h     int64   `json:"trades_24h"`
	OpenInterest  string  `json:"open_interest"`
	FundingRate  string  `json:"funding_rate"`
}

// UserManagement handles user management
type UserManagement struct {
	mu    sync.RWMutex
	users map[string]*UserView
	db    *sql.DB
}

// UserView represents user detail view
type UserView struct {
	ID             string  `json:"id"`
	Email          string  `json:"email"`
	Username       string  `json:"username"`
	Status         string  `json:"status"`
	KyCStatus      string  `json:"kyc_status"`
	RiskLevel      string  `json:"risk_level"`
	Accounts      []AccountSummary `json:"accounts"`
	TotalDeposit  string    `json:"total_deposit"`
	TotalWithdraw string   `json:"total_withdraw"`
	TotalVolume  string    `json:"total_volume"`
	CreatedAt     time.Time `json:"created_at"`
	LastLoginAt   *time.Time `json:"last_login_at"`
	Locked       bool    `json:"locked"`
}

// AccountSummary represents account overview
type AccountSummary struct {
	Type    string `json:"type"`
	Balance string `json:"balance"`
	Currency string `json:"currency"`
}

// FeeConfig represents fee configuration
type FeeConfig struct {
	Symbol        string `json:"symbol"`
	MakerFee     string `json:"maker_fee"`
	TakerFee     string `json:"taker_fee"`
	VIPTiers     []VIPTier `json:"vip_tiers"`
	UpdatedAt    time.Time `json:"updated_at"`
	UpdatedBy   string    `json:"updated_by"`
}

// VIPTier represents VIP tier
type VIPTier struct {
	Tier       int     `json:"tier"`
	Name      string  `json:"name"`
	Volume30d float64 `json:"volume_30d"`
	MakerFee  string  `json:"maker_fee"`
	TakerFee  string  `json:"taker_fee"`
}

// MarketConfig represents market configuration
type MarketConfig struct {
	Symbol        string `json:"symbol"`
	Status        string `json:"status"`
	IsTradable    bool   `json:"is_tradable"`
	MarginEnabled bool   `json:"margin_enabled"`
	MinPrice      string `json:"min_price"`
	MaxPrice     string `json:"max_price"`
	MinQuantity  string `json:"min_quantity"`
	MaxQuantity string `json:"max_quantity"`
	LotSize      string `json:"lot_size"`
	TickSize    string `json:"tick_size"`
	Leverage    string `json:"leverage"`
}

// Ticket represents support ticket
type Ticket struct {
	ID          string    `json:"id" db:"id"`
	UserID      string    `json:"user_id" db:"user_id"`
	Subject     string    `json:"subject" db:"subject"`
	Category    string    `json:"category" db:"category"`
	Priority   string    `json:"priority" db:"priority"`
	Status      string    `json:"status" db:"status"`
	AssignedTo sql.NullString `json:"assigned_to" db:"assigned_to"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time `json:"updated_at" db:"updated_at"`
	ClosedAt    *time.Time `json:"closed_at" db:-`
}

// AdminPanel provides admin panel functionality
type AdminPanel struct {
	mu           sync.RWMutex
	admins      map[string]*AdminUser
	stats       *DashboardStats
	userMgmt    *UserManagement
	auditLogger *AuditLogger
	db         *sql.DB
}

// AuditLogger logs all admin actions
type AuditLogger struct {
	mu    sync.Mutex
	logs []AuditLog
}

// NewAdminPanel creates new admin panel
func NewAdminPanel() *AdminPanel {
	return &AdminPanel{
		admins:   make(map[string]*AdminUser),
		stats:   &DashboardStats{},
		userMgmt: &UserManagement{users: make(map[string]*UserView)},
		auditLogger: &AuditLogger{logs: make([]AuditLog, 0)},
	}
}

// GetDashboardStats returns dashboard statistics
func (ap *AdminPanel) GetDashboardStats(ctx context.Context) (*DashboardStats, error) {
	// In production, would query database
	return ap.stats, nil
}

// GetMarketStats returns market statistics
func (ap *AdminPanel) GetMarketStats(ctx context.Context, symbol string) (*MarketStats, error) {
	// In production, would query database
	return &MarketStats{
		Symbol:        symbol,
		Price:        "0.00",
		Change24h:     "0.00%",
		Volume24h:     "0.00",
		Trades24h:    0,
		OpenInterest:  "0.00",
		FundingRate:  "0.00%",
	}, nil
}

// GetUsers returns paginated users
func (ap *AdminPanel) GetUsers(ctx context.Context, filters UserFilters, pagination Pagination) ([]*UserView, error) {
	// Filters and pagination
	users := make([]*UserView, 0)
	return users, nil
}

// ApproveKYC approves a KYC application
func (ap *AdminPanel) ApproveKYC(ctx context.Context, adminID, userID, notes string) error {
	// Log action
	ap.logAction(ctx, adminID, "APPROVE_KYC", userID, notes)

	// In production, would approve in database
	return nil
}

// RejectKYC rejects a KYC application
func (ap *AdminPanel) RejectKYC(ctx context.Context, adminID, userID, reason string) error {
	// Log action
	ap.logAction(ctx, adminID, "REJECT_KYC", userID, reason)

	return nil
}

// LockUser locks a user account
func (ap *AdminPanel) LockUser(ctx context.Context, adminID, userID, reason string) error {
	ap.logAction(ctx, adminID, "LOCK_USER", userID, reason)
	return nil
}

// UnlockUser unlocks a user account
func (ap *AdminPanel) UnlockUser(ctx context.Context, adminID, userID string) error {
	ap.logAction(ctx, adminID, "UNLOCK_USER", userID, "")
	return nil
}

// FreezeWithdrawal freezes user withdrawals
func (ap *AdminPanel) FreezeWithdrawal(ctx context.Context, adminID, userID, reason string) error {
	ap.logAction(ctx, adminID, "FREEZE_WITHDRAWAL", userID, reason)
	return nil
}

// UnfreezeWithdrawal unfreezes user withdrawals
func (ap *AdminPanel) UnfreezeWithdrawal(ctx context.Context, adminID, userID string) error {
	ap.logAction(ctx, adminID, "UNFREEZE_WITHDRAWAL", userID, "")
	return nil
}

// UpdateFeeConfig updates fee configuration
func (ap *AdminPanel) UpdateFeeConfig(ctx context.Context, adminID, symbol string, config *FeeConfig) error {
	config.UpdatedAt = time.Now()
	config.UpdatedBy = adminID
	ap.logAction(ctx, adminID, "UPDATE_FEE", symbol, fmt.Sprintf("maker: %s, taker: %s", config.MakerFee, config.TakerFee))
	return nil
}

// UpdateMarketConfig updates market configuration
func (ap *AdminPanel) UpdateMarketConfig(ctx context.Context, adminID string, config *MarketConfig) error {
	ap.logAction(ctx, adminID, "UPDATE_MARKET", config.Symbol, "")
	return nil
}

// CreateToken creates a new trading pair
func (ap *AdminPanel) CreateToken(ctx context.Context, adminID, base, quote string, config *MarketConfig) error {
	config.Symbol = base + quote
	return ap.UpdateMarketConfig(ctx, adminID, config)
}

// DisableToken disables a trading pair
func (ap *AdminPanel) DisableToken(ctx context.Context, adminID, symbol string) error {
	ap.logAction(ctx, adminID, "DISABLE_MARKET", symbol, "")
	return nil
}

// GetAuditLogs returns audit logs
func (ap *AdminPanel) GetAuditLogs(ctx context.Context, filters AuditFilters, pagination Pagination) ([]*AuditLog, error) {
	return ap.auditLogger.logs, nil
}

// AssignTicket assigns a ticket to agent
func (ap *AdminPanel) AssignTicket(ctx context.Context, adminID, ticketID, agentID string) error {
	// Log action
	ap.logAction(ctx, adminID, "ASSIGN_TICKET", ticketID, agentID)

	return nil
}

// RespondTicket responds to a ticket
func (ap *AdminPanel) RespondTicket(ctx context.Context, adminID, ticketID, message string) error {
	ap.logAction(ctx, adminID, "TICKET_RESPONSE", ticketID, message)

	return nil
}

// ResolveTicket resolves a ticket
func (ap *AdminPanel) ResolveTicket(ctx context.Context, adminID, ticketID, resolution string) error {
	ap.logAction(ctx, adminID, "RESOLVE_TICKET", ticketID, resolution)

	return nil
}

// Export exports data
func (ap *AdminPanel) Export(ctx context.Context, adminID, exportType string, filters interface{}) ([]byte, error) {
	ap.logAction(ctx, adminID, "EXPORT_DATA", exportType, "")

	// Would export to CSV/Excel
	return []byte(""), nil
}

// CreateAdmin creates an admin user
func (ap *AdminPanel) CreateAdmin(ctx context.Context, admin *AdminUser) error {
	admin.ID = generateAdminID()
	admin.CreatedAt = time.Now()

	ap.mu.Lock()
	ap.admins[admin.ID] = admin
	ap.mu.Unlock()

	return nil
}

// HasPermission checks if admin has permission
func (ap *AdminPanel) HasPermission(adminID string, perm Permission) bool {
	ap.mu.RLock()
	admin, ok := ap.admins[adminID]
	ap.mu.RUnlock()

	if !ok {
		return false
	}

	for _, p := range admin.Permissions {
		if p == perm {
			return true
		}
	}

	// Super admin has all permissions
	return admin.Role == RoleSuperAdmin
}

// Helper functions
func (ap *AdminPanel) logAction(ctx context.Context, adminID, action, resource, details string) {
	log := AuditLog{
		ID:        generateLogID(),
		UserID:   adminID,
		Action:   action,
		Resource: resource,
		Details:  details,
		CreatedAt: time.Now(),
	}

	ap.auditLogger.mu.Lock()
	ap.auditLogger.logs = append(ap.auditLogger.logs, log)
	ap.auditLogger.mu.Unlock()
}

func generateAdminID() string {
	return fmt.Sprintf("ADMIN%d%d", time.Now().UnixNano(), time.Now().Nanosecond())
}

func generateLogID() string {
	return fmt.Sprintf("LOG%d%d", time.Now().UnixNano(), time.Now().Nanosecond())
}

// UserFilters represents user filters
type UserFilters struct {
	Search     string
	Status    string
	KyCStatus string
	DateFrom   *time.Time
	DateTo    *time.Time
}

// UserPagination represents pagination
type Pagination struct {
	Page    int `json:"page"`
	PerPage int `json:"per_page"`
}

// AuditFilters represents audit filters
type AuditFilters struct {
	UserID   string
	Action   string
	DateFrom time.Time
	DateTo   time.Time
}