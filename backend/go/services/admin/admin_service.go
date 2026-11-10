// TigerEx Admin Management Service
// Administrative functions and user management

package admin

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

const (
	RoleSuperAdmin = "super_admin"
	RoleAdmin      = "admin"
	RoleModerator  = "moderator"
	RoleSupport    = "support"

	StatusActive   = "active"
	StatusInactive = "inactive"
	StatusBanned   = "banned"

	ActionLogin      = "login"
	ActionLogout     = "logout"
	ActionBan        = "ban"
	ActionUnban      = "unban"
	ActionKYCApprove = "kyc_approve"
	ActionKYCReject  = "kyc_reject"
	ActionWithdraw   = "withdraw"
	ActionTrade      = "trade"
	ActionTransfer   = "transfer"
)

type Admin struct {
	ID           string    `json:"id"`
	Email        string    `json:"email"`
	Username     string    `json:"username"`
	PasswordHash string    `json:"-"`
	Role         string    `json:"role"`
	Status       string    `json:"status"`
	Permissions  []string  `json:"permissions"`
	LastLoginAt  time.Time `json:"last_login_at"`
	CreatedAt    time.Time `json:"created_at"`
}

type AuditLog struct {
	ID         string    `json:"id"`
	AdminID    string    `json:"admin_id"`
	Action     string    `json:"action"`
	TargetType string    `json:"target_type"`
	TargetID   string    `json:"target_id"`
	Details    string    `json:"details"`
	IP         string    `json:"ip"`
	Timestamp  time.Time `json:"timestamp"`
}

type UserAction struct {
	ID        string    `json:"id"`
	AdminID   string    `json:"admin_id"`
	UserID    string    `json:"user_id"`
	Action    string    `json:"action"`
	Reason    string    `json:"reason"`
	Notes     string    `json:"notes"`
	CreatedAt time.Time `json:"created_at"`
}

type SystemStats struct {
	TotalUsers          int     `json:"total_users"`
	ActiveUsers         int     `json:"active_users"`
	TotalVolume24h      float64 `json:"total_volume_24h"`
	TotalTrades24h      int     `json:"total_trades_24h"`
	TotalDeposits24h    float64 `json:"total_deposits_24h"`
	TotalWithdrawals24h float64 `json:"total_withdrawals_24h"`
	FeeRevenue24h       float64 `json:"fee_revenue_24h"`
}

// Directory is the source of truth for end-user data (accounts, trade
// history, exchange-wide statistics). The admin manager never invents these
// values: without a configured directory, the read methods fail closed.
type Directory interface {
	Stats(ctx context.Context) (SystemStats, error)
	SearchUsers(ctx context.Context, query string) ([]string, error)
	GetUserHistory(ctx context.Context, userID string) (map[string]interface{}, error)
}

// ErrAdminDirectoryUnavailable is returned by user-facing admin reads when no
// Directory is configured. Returning zeros or empty slices instead would
// present fabricated data as if it were measured.
var ErrAdminDirectoryUnavailable = errors.New("admin user directory is not configured; refusing to return fabricated user data")

type AdminManager struct {
	mu          sync.RWMutex
	admins      map[string]*Admin
	emailIndex  map[string]string
	auditLogs   []AuditLog
	userActions []UserAction
	directory   Directory
}

func NewAdminManager() *AdminManager {
	return &AdminManager{
		admins:     make(map[string]*Admin),
		emailIndex: make(map[string]string),
		auditLogs:  make([]AuditLog, 0, 10000),
	}
}

// SetDirectory wires the user-data source used by the read-only admin queries.
// It must be called before those queries; until then they return
// ErrAdminDirectoryUnavailable.
func (am *AdminManager) SetDirectory(dir Directory) {
	am.mu.Lock()
	defer am.mu.Unlock()
	am.directory = dir
}

func (am *AdminManager) getDirectory() Directory {
	am.mu.RLock()
	defer am.mu.RUnlock()
	return am.directory
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func validAdminEmail(email string) bool {
	parsed, err := mail.ParseAddress(email)
	return err == nil && parsed.Address == email && strings.Contains(email, "@")
}

func cloneAdmin(admin *Admin, includeHash bool) *Admin {
	if admin == nil {
		return nil
	}
	copy := *admin
	copy.Permissions = append([]string(nil), admin.Permissions...)
	if !includeHash {
		copy.PasswordHash = ""
	}
	return &copy
}

func (am *AdminManager) CreateAdmin(email, username, password, role string) (*Admin, error) {
	email = normalizeEmail(email)
	username = strings.TrimSpace(username)
	if !validAdminEmail(email) || username == "" {
		return nil, errors.New("valid email and username are required")
	}
	if len(password) < 12 {
		return nil, errors.New("password must be at least 12 characters")
	}
	validRoles := map[string]bool{
		RoleSuperAdmin: true, RoleAdmin: true, RoleModerator: true, RoleSupport: true,
	}
	if !validRoles[role] {
		return nil, errors.New("invalid role")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return nil, fmt.Errorf("hash admin password: %w", err)
	}

	am.mu.Lock()
	defer am.mu.Unlock()
	if _, exists := am.emailIndex[email]; exists {
		return nil, errors.New("email already exists")
	}
	now := time.Now().UTC()
	admin := &Admin{
		ID: uuid.NewString(), Email: email, Username: username,
		PasswordHash: string(hash), Role: role, Status: StatusActive,
		CreatedAt: now,
	}
	am.admins[admin.ID] = admin
	am.emailIndex[email] = admin.ID
	am.logAction(admin.ID, "create_admin", "admin", admin.ID, "Created admin: "+username, "")
	return cloneAdmin(admin, false), nil
}

func (am *AdminManager) GetAdmin(adminID string) (*Admin, error) {
	am.mu.RLock()
	defer am.mu.RUnlock()
	admin, exists := am.admins[adminID]
	if !exists {
		return nil, errors.New("admin not found")
	}
	return cloneAdmin(admin, false), nil
}

func (am *AdminManager) GetAdminByEmail(email string) (*Admin, error) {
	am.mu.RLock()
	defer am.mu.RUnlock()
	adminID, exists := am.emailIndex[normalizeEmail(email)]
	if !exists {
		return nil, errors.New("admin not found")
	}
	return cloneAdmin(am.admins[adminID], false), nil
}

func (am *AdminManager) Login(email, password string) (*Admin, error) {
	email = normalizeEmail(email)
	am.mu.RLock()
	adminID, exists := am.emailIndex[email]
	var stored *Admin
	if exists {
		stored = cloneAdmin(am.admins[adminID], true)
	}
	am.mu.RUnlock()
	if !exists || stored == nil || stored.Status != StatusActive ||
		bcrypt.CompareHashAndPassword([]byte(stored.PasswordHash), []byte(password)) != nil {
		return nil, errors.New("invalid credentials")
	}

	am.mu.Lock()
	defer am.mu.Unlock()
	current, ok := am.admins[adminID]
	if !ok || current.Status != StatusActive {
		return nil, errors.New("invalid credentials")
	}
	current.LastLoginAt = time.Now().UTC()
	am.logAction(current.ID, ActionLogin, "admin", current.ID, "Admin logged in", "")
	return cloneAdmin(current, false), nil
}

func (am *AdminManager) BanUser(adminID, userID, reason string) error {
	am.mu.Lock()
	defer am.mu.Unlock()

	action := UserAction{
		ID:        fmt.Sprintf("UA%d%d", time.Now().Unix(), time.Now().Nanosecond()),
		AdminID:   adminID,
		UserID:    userID,
		Action:    ActionBan,
		Reason:    reason,
		CreatedAt: time.Now(),
	}

	am.userActions = append(am.userActions, action)
	am.logAction(adminID, ActionBan, "user", userID, reason, "")

	return nil
}

func (am *AdminManager) UnbanUser(adminID, userID, reason string) error {
	am.mu.Lock()
	defer am.mu.Unlock()

	action := UserAction{
		ID:        fmt.Sprintf("UA%d%d", time.Now().Unix(), time.Now().Nanosecond()),
		AdminID:   adminID,
		UserID:    userID,
		Action:    ActionUnban,
		Reason:    reason,
		CreatedAt: time.Now(),
	}

	am.userActions = append(am.userActions, action)
	am.logAction(adminID, ActionUnban, "user", userID, reason, "")

	return nil
}

func (am *AdminManager) GetUserActions(userID string) []UserAction {
	am.mu.RLock()
	defer am.mu.RUnlock()

	var actions []UserAction
	for _, action := range am.userActions {
		if action.UserID == userID {
			actions = append(actions, action)
		}
	}
	return actions
}

func (am *AdminManager) GetAuditLogs(limit int) []AuditLog {
	am.mu.RLock()
	defer am.mu.RUnlock()

	if limit <= 0 {
		return nil
	}
	start := len(am.auditLogs) - limit
	if start < 0 {
		start = 0
	}
	return append([]AuditLog(nil), am.auditLogs[start:]...)
}

func (am *AdminManager) GetAdminAuditLogs(adminID string, limit int) []AuditLog {
	am.mu.RLock()
	defer am.mu.RUnlock()

	var logs []AuditLog
	count := 0
	for i := len(am.auditLogs) - 1; i >= 0 && count < limit; i-- {
		if am.auditLogs[i].AdminID == adminID {
			logs = append(logs, am.auditLogs[i])
			count++
		}
	}
	return append([]AuditLog(nil), logs...)
}

func (am *AdminManager) logAction(adminID, action, targetType, targetID, details, ip string) {
	log := AuditLog{
		ID:         fmt.Sprintf("LOG%d%d", time.Now().Unix(), time.Now().Nanosecond()),
		AdminID:    adminID,
		Action:     action,
		TargetType: targetType,
		TargetID:   targetID,
		Details:    details,
		IP:         ip,
		Timestamp:  time.Now(),
	}

	am.auditLogs = append(am.auditLogs, log)

	if len(am.auditLogs) > 10000 {
		am.auditLogs = append([]AuditLog(nil), am.auditLogs[len(am.auditLogs)-10000:]...)
	}
}

// GetSystemStats reports exchange-wide statistics from the configured
// Directory. It fails closed rather than returning zeroed counters.
func (am *AdminManager) GetSystemStats(ctx context.Context) (SystemStats, error) {
	dir := am.getDirectory()
	if dir == nil {
		return SystemStats{}, ErrAdminDirectoryUnavailable
	}
	return dir.Stats(ctx)
}

func (am *AdminManager) CheckPermission(adminID, permission string) (bool, error) {
	admin, err := am.GetAdmin(adminID)
	if err != nil {
		return false, err
	}

	if admin.Role == RoleSuperAdmin {
		return true, nil
	}

	permissionMap := map[string][]string{
		RoleAdmin:     {"all"},
		RoleModerator: {"view_users", "view_trades", "kyc_review"},
		RoleSupport:   {"view_users", "kyc_review"},
	}

	perms, ok := permissionMap[admin.Role]
	if !ok {
		return false, nil
	}

	for _, p := range perms {
		if p == "all" || p == permission {
			return true, nil
		}
	}

	return false, nil
}

func (am *AdminManager) UpdateAdminStatus(adminID, status string) error {
	am.mu.Lock()
	defer am.mu.Unlock()

	admin, exists := am.admins[adminID]
	if !exists {
		return errors.New("admin not found")
	}

	admin.Status = status
	return nil
}

func (am *AdminManager) GetAllAdmins() []*Admin {
	am.mu.RLock()
	defer am.mu.RUnlock()

	admins := make([]*Admin, 0, len(am.admins))
	for _, admin := range am.admins {
		admins = append(admins, cloneAdmin(admin, false))
	}
	return admins
}

// SearchUsers returns matching account ids from the configured Directory. An
// empty query is rejected so a caller cannot accidentally enumerate every user.
func (am *AdminManager) SearchUsers(ctx context.Context, query string) ([]string, error) {
	if strings.TrimSpace(query) == "" {
		return nil, errors.New("search query must not be empty")
	}
	dir := am.getDirectory()
	if dir == nil {
		return nil, ErrAdminDirectoryUnavailable
	}
	return dir.SearchUsers(ctx, query)
}

// GetUserHistory reports trading history for one account from the configured
// Directory. It fails closed rather than returning invented zero totals.
func (am *AdminManager) GetUserHistory(ctx context.Context, userID string) (map[string]interface{}, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, errors.New("user id is required")
	}
	dir := am.getDirectory()
	if dir == nil {
		return nil, ErrAdminDirectoryUnavailable
	}
	return dir.GetUserHistory(ctx, userID)
}
