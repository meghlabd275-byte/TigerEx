// TigerEx Admin Management Service
// Administrative functions and user management

package admin

import (
	"errors"
	"fmt"
	"sync"
	"time"
)

const (
	RoleSuperAdmin = "super_admin"
	RoleAdmin     = "admin"
	RoleModerator = "moderator"
	RoleSupport   = "support"

	StatusActive   = "active"
	StatusInactive = "inactive"
	StatusBanned  = "banned"

	ActionLogin     = "login"
	ActionLogout    = "logout"
	ActionBan       = "ban"
	ActionUnban     = "unban"
	ActionKYCApprove = "kyc_approve"
	ActionKYCReject = "kyc_reject"
	ActionWithdraw  = "withdraw"
	ActionTrade    = "trade"
	ActionTransfer = "transfer"
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
	TotalUsers       int     `json:"total_users"`
	ActiveUsers     int     `json:"active_users"`
	TotalVolume24h  float64 `json:"total_volume_24h"`
	TotalTrades24h int     `json:"total_trades_24h"`
	TotalDeposits24h float64 `json:"total_deposits_24h"`
	TotalWithdrawals24h float64 `json:"total_withdrawals_24h"`
	FeeRevenue24h   float64 `json:"fee_revenue_24h"`
}

type AdminManager struct {
	mu          sync.RWMutex
	admins      map[string]*Admin
	emailIndex  map[string]string
	auditLogs   []AuditLog
	userActions []UserAction
}

func NewAdminManager() *AdminManager {
	am := &AdminManager{
		admins:     make(map[string]*Admin),
		emailIndex: make(map[string]string),
		auditLogs:  make([]AuditLog, 0, 10000),
	}
	am.createDefaultAdmin()
	return am
}

func (am *AdminManager) createDefaultAdmin() {
	// Default super admin for initial setup
	admin := &Admin{
		ID:         "ADMIN001",
		Email:      "admin@tigerex.com",
		Username:  "admin",
		Role:      RoleSuperAdmin,
		Status:    StatusActive,
		CreatedAt: time.Now(),
	}
	am.admins[admin.ID] = admin
	am.emailIndex[admin.Email] = admin.ID
}

func (am *AdminManager) CreateAdmin(email, username, password, role string) (*Admin, error) {
	am.mu.Lock()
	defer am.mu.Unlock()

	if _, exists := am.emailIndex[email]; exists {
		return nil, errors.New("email already exists")
	}

	validRoles := map[string]bool{
		RoleSuperAdmin: true,
		RoleAdmin:     true,
		RoleModerator: true,
		RoleSupport:   true,
	}

	if !validRoles[role] {
		return nil, errors.New("invalid role")
	}

	admin := &Admin{
		ID:        fmt.Sprintf("ADM%d%d", time.Now().Unix(), time.Now().Nanosecond()),
		Email:     email,
		Username:  username,
		Role:      role,
		Status:    StatusActive,
		CreatedAt: time.Now(),
	}

	am.admins[admin.ID] = admin
	am.emailIndex[email] = admin.ID

	am.logAction(admin.ID, "create_admin", "admin", admin.ID, "Created admin: "+username, "")

	return admin, nil
}

func (am *AdminManager) GetAdmin(adminID string) (*Admin, error) {
	am.mu.RLock()
	defer am.mu.RUnlock()

	admin, exists := am.admins[adminID]
	if !exists {
		return nil, errors.New("admin not found")
	}
	return admin, nil
}

func (am *AdminManager) GetAdminByEmail(email string) (*Admin, error) {
	am.mu.RLock()
	defer am.mu.RUnlock()

	adminID, exists := am.emailIndex[email]
	if !exists {
		return nil, errors.New("admin not found")
	}

	return am.admins[adminID], nil
}

func (am *AdminManager) Login(email, password string) (*Admin, error) {
	am.mu.RLock()
	adminID, exists := am.emailIndex[email]
	am.mu.RUnlock()

	if !exists {
		return nil, errors.New("invalid credentials")
	}

	am.mu.RLock()
	admin := am.admins[adminID]
	am.mu.RUnlock()

	if admin.Status != StatusActive {
		return nil, errors.New("account is not active")
	}

	admin.LastLoginAt = time.Now()
	am.logAction(admin.ID, ActionLogin, "admin", admin.ID, "Admin logged in", "")

	return admin, nil
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

	if limit > 0 && len(am.auditLogs) > limit {
		return am.auditLogs[-limit:]
	}
	return am.auditLogs
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
	return logs
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
		am.auditLogs = am.auditLogs[-10000:]
	}
}

func (am *AdminManager) GetSystemStats() SystemStats {
	am.mu.RLock()
	defer am.mu.RUnlock()

	return SystemStats{
		TotalUsers:        0,
		ActiveUsers:      0,
		TotalVolume24h:   0,
		TotalTrades24h:   0,
		TotalDeposits24h: 0,
		FeeRevenue24h:    0,
	}
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
		admins = append(admins, admin)
	}
	return admins
}

func (am *AdminManager) SearchUsers(query string) []string {
	// In production, this would search the database
	return []string{}
}

func (am *AdminManager) GetUserHistory(userID string) map[string]interface{} {
	return map[string]interface{}{
		"user_id":     userID,
		"total_trades": 0,
		"total_volume": 0.0,
		"first_trade":  nil,
		"last_trade":   nil,
	}
}
