package admin_dashboard

import (
	"errors"
	"fmt"
	"math/rand"
	"sync"
	"time"
)

// AdminRole represents admin role
type AdminRole string

const (
	RoleSuperAdmin    AdminRole = "SUPER_ADMIN"
	RoleAdmin         AdminRole = "ADMIN"
	RoleCompliance    AdminRole = "COMPLIANCE"
	RoleSupport       AdminRole = "SUPPORT"
	RoleDeveloper     AdminRole = "DEVELOPER"
	RoleViewer        AdminRole = "VIEWER"
)

// AdminUser represents an admin user
type AdminUser struct {
	ID           string    `json:"id"`
	Email        string    `json:"email"`
	Name         string    `json:"name"`
	Role         AdminRole `json:"role"`
	Permissions  []string  `json:"permissions"`
	IsActive     bool      `json:"is_active"`
	LastLogin    time.Time `json:"last_login"`
	FailedLogins int       `json:"failed_logins"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// AuditLog represents an audit log entry
type AuditLog struct {
	ID         string    `json:"id"`
	UserID     string    `json:"user_id"`
	Action     string    `json:"action"`
	Resource   string    `json:"resource"`
	ResourceID string    `json:"resource_id"`
	Details    string    `json:"details"`
	IPAddress  string    `json:"ip_address"`
	UserAgent  string    `json:"user_agent"`
	Timestamp  time.Time `json:"timestamp"`
}

// SystemMetrics represents system metrics
type SystemMetrics struct {
	TotalUsers        int64     `json:"total_users"`
	ActiveUsers24h    int64     `json:"active_users_24h"`
	TotalTrades       int64     `json:"total_trades"`
	Volume24h         float64   `json:"volume_24h"`
	PendingWithdrawals float64   `json:"pending_withdrawals"`
	PendingKYC         int       `json:"pending_kyc"`
	OpenTickets       int       `json:"open_tickets"`
	ActiveBots        int       `json:"active_bots"`
	CPUUsage          float64   `json:"cpu_usage"`
	MemoryUsage       float64   `json:"memory_usage"`
	DBConnections     int       `json:"db_connections"`
	Timestamp         time.Time `json:"timestamp"`
}

// FeeStructure represents trading fee structure
type FeeStructure struct {
	Symbol         string  `json:"symbol"`
	MakerFee       float64 `json:"maker_fee"`
	TakerFee       float64 `json:"taker_fee"`
	MinMakerFee    float64 `json:"min_maker_fee"`
	MaxMakerFee    float64 `json:"max_maker_fee"`
	MinTakerFee    float64 `json:"min_taker_fee"`
	MaxTakerFee    float64 `json:"max_taker_fee"`
	VIPDiscount    float64 `json:"vip_discount"`
	BNBDiscount    float64 `json:"bnb_discount"`
	IsActive       bool    `json:"is_active"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// AssetConfig represents asset configuration
type AssetConfig struct {
	Symbol         string  `json:"symbol"`
	Name           string  `json:"name"`
	Type           string  `json:"type"` // CRYPTO, FIAT, TOKEN
	DepositEnabled bool    `json:"deposit_enabled"`
	WithdrawEnabled bool   `json:"withdraw_enabled"`
	TradeEnabled   bool    `json:"trade_enabled"`
	MinDeposit     float64 `json:"min_deposit"`
	MinWithdraw    float64 `json:"min_withdraw"`
	MaxWithdraw    float64 `json:"max_withdraw"`
	WithdrawalFee  float64 `json:"withdrawal_fee"`
	IsActive       bool    `json:"is_active"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// MaintenanceWindow represents system maintenance window
type MaintenanceWindow struct {
	ID          string    `json:"id"`
	Type        string    `json:"type"` // PLANNED, EMERGENCY
	StartTime   time.Time `json:"start_time"`
	EndTime     time.Time `json:"end_time"`
	Description string    `json:"description"`
	IsActive    bool      `json:"is_active"`
	CreatedBy   string    `json:"created_by"`
	CreatedAt   time.Time `json:"created_at"`
}

// Announcement represents a system announcement
type Announcement struct {
	ID         string    `json:"id"`
	Title      string    `json:"title"`
	Content    string    `json:"content"`
	Type       string    `json:"type"` // INFO, WARNING, CRITICAL
	Priority   string    `json:"priority"` // LOW, MEDIUM, HIGH
	Target     string    `json:"target"` // ALL, SPECIFIC_USERS, SPECIFIC_COUNTRIES
	TargetList []string  `json:"target_list,omitempty"`
	StartTime  time.Time `json:"start_time"`
	EndTime    *time.Time `json:"end_time,omitempty"`
	IsActive   bool      `json:"is_active"`
	CreatedBy  string    `json:"created_by"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// AdminService handles admin dashboard operations
type AdminService struct {
	mu            sync.RWMutex
	admins       map[string]*AdminUser // userID -> admin
	auditLogs    []*AuditLog
	metrics      *SystemMetrics
	feeStructures map[string]*FeeStructure // symbol -> structure
	assets       map[string]*AssetConfig // symbol -> config
	maintenance  []*MaintenanceWindow
	announcements []*Announcement
}

// NewAdminService creates a new admin service
func NewAdminService() *AdminService {
	return &AdminService{
		admins:        make(map[string]*AdminUser),
		auditLogs:     make([]*AuditLog, 0),
		metrics:       &SystemMetrics{},
		feeStructures: make(map[string]*FeeStructure),
		assets:        make(map[string]*AssetConfig),
		maintenance:   make([]*MaintenanceWindow, 0),
		announcements: make([]*Announcement, 0),
	}
}

// CreateAdmin creates a new admin user
func (s *AdminService) CreateAdmin(email, name string, role AdminRole, permissions []string) (*AdminUser, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.admins[email]; exists {
		return nil, errors.New("admin already exists")
	}

	admin := &AdminUser{
		ID:          generateID(),
		Email:       email,
		Name:        name,
		Role:        role,
		Permissions: permissions,
		IsActive:    true,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	s.admins[email] = admin
	s.logAction("SYSTEM", "admin_create", email, "Admin created: "+email, "", "")

	return admin, nil
}

// GetAdmin retrieves an admin by email
func (s *AdminService) GetAdmin(email string) (*AdminUser, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	admin, exists := s.admins[email]
	if !exists {
		return nil, errors.New("admin not found")
	}

	return admin, nil
}

// UpdateAdminPermissions updates admin permissions
func (s *AdminService) UpdateAdminPermissions(email string, permissions []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	admin, exists := s.admins[email]
	if !exists {
		return errors.New("admin not found")
	}

	admin.Permissions = permissions
	admin.UpdatedAt = time.Now()
	s.logAction(email, "permission_update", "admin", email, "Permissions updated", "", "")

	return nil
}

// DeactivateAdmin deactivates an admin
func (s *AdminService) DeactivateAdmin(email, performedBy string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	admin, exists := s.admins[email]
	if !exists {
		return errors.New("admin not found")
	}

	admin.IsActive = false
	admin.UpdatedAt = time.Now()
	s.logAction(performedBy, "admin_deactivate", email, "Admin deactivated: "+email, "", "")

	return nil
}

// GetAuditLogs retrieves audit logs with filters
func (s *AdminService) GetAuditLogs(userID string, action string, startTime, endTime time.Time, limit, offset int) ([]*AuditLog, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var logs []*AuditLog
	for _, log := range s.auditLogs {
		if userID != "" && log.UserID != userID {
			continue
		}
		if action != "" && log.Action != action {
			continue
		}
		if startTime.After(log.Timestamp) || endTime.Before(log.Timestamp) {
			continue
		}
		logs = append(logs, log)
	}

	// Apply pagination
	start := offset
	if start > len(logs) {
		start = len(logs)
	}
	end := start + limit
	if end > len(logs) {
		end = len(logs)
	}

	return logs[start:end], nil
}

// LogAction logs an admin action
func (s *AdminService) LogAction(userID, action, resource, resourceID, details, ipAddress, userAgent string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.logAction(userID, action, resource, resourceID, details, ipAddress, userAgent)
}

func (s *AdminService) logAction(userID, action, resource, resourceID, details, ipAddress, userAgent string) {
	log := &AuditLog{
		ID:         generateID(),
		UserID:     userID,
		Action:     action,
		Resource:   resource,
		ResourceID: resourceID,
		Details:    details,
		IPAddress:  ipAddress,
		UserAgent:  userAgent,
		Timestamp:  time.Now(),
	}
	s.auditLogs = append(s.auditLogs, log)
}

// UpdateSystemMetrics updates system metrics
func (s *AdminService) UpdateSystemMetrics(metrics *SystemMetrics) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	metrics.Timestamp = time.Now()
	s.metrics = metrics
	return nil
}

// GetSystemMetrics retrieves current system metrics
func (s *AdminService) GetSystemMetrics() *SystemMetrics {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.metrics
}

// UpdateFeeStructure updates trading fee structure
func (s *AdminService) UpdateFeeStructure(symbol string, structure *FeeStructure) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	structure.Symbol = symbol
	structure.UpdatedAt = time.Now()
	s.feeStructures[symbol] = structure

	return nil
}

// GetFeeStructure retrieves fee structure for a symbol
func (s *AdminService) GetFeeStructure(symbol string) (*FeeStructure, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	structure, exists := s.feeStructures[symbol]
	if !exists {
		return nil, errors.New("fee structure not found")
	}

	return structure, nil
}

// GetAllFeeStructures retrieves all fee structures
func (s *AdminService) GetAllFeeStructures() []*FeeStructure {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var structures []*FeeStructure
	for _, s := range s.feeStructures {
		structures = append(structures, s)
	}

	return structures
}

// UpdateAssetConfig updates asset configuration
func (s *AdminService) UpdateAssetConfig(symbol string, config *AssetConfig) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	config.Symbol = symbol
	config.UpdatedAt = time.Now()
	s.assets[symbol] = config

	return nil
}

// GetAssetConfig retrieves asset configuration
func (s *AdminService) GetAssetConfig(symbol string) (*AssetConfig, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	config, exists := s.assets[symbol]
	if !exists {
		return nil, errors.New("asset not found")
	}

	return config, nil
}

// GetAllAssets retrieves all asset configurations
func (s *AdminService) GetAllAssets() []*AssetConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var assets []*AssetConfig
	for _, a := range s.assets {
		assets = append(assets, a)
	}

	return assets
}

// CreateMaintenanceWindow creates a maintenance window
func (s *AdminService) CreateMaintenanceWindow(window *MaintenanceWindow) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	window.ID = generateID()
	window.CreatedAt = time.Now()
	s.maintenance = append(s.maintenance, window)

	return nil
}

// GetActiveMaintenance retrieves active maintenance windows
func (s *AdminService) GetActiveMaintenance() []*MaintenanceWindow {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var active []*MaintenanceWindow
	now := time.Now()
	for _, w := range s.maintenance {
		if w.IsActive && now.After(w.StartTime) && now.Before(w.EndTime) {
			active = append(active, w)
		}
	}

	return active
}

// CreateAnnouncement creates a system announcement
func (s *AdminService) CreateAnnouncement(announcement *Announcement) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	announcement.ID = generateID()
	announcement.CreatedAt = time.Now()
	announcement.UpdatedAt = time.Now()
	s.announcements = append(s.announcements, announcement)

	return nil
}

// GetActiveAnnouncements retrieves active announcements
func (s *AdminService) GetActiveAnnouncements() []*Announcement {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var active []*Announcement
	now := time.Now()
	for _, a := range s.announcements {
		if a.IsActive && now.After(a.StartTime) {
			if a.EndTime == nil || now.Before(*a.EndTime) {
				active = append(active, a)
			}
		}
	}

	return active
}

// UpdateAnnouncement updates an announcement
func (s *AdminService) UpdateAnnouncement(id string, announcement *Announcement) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i, a := range s.announcements {
		if a.ID == id {
			announcement.ID = id
			announcement.UpdatedAt = time.Now()
			s.announcements[i] = announcement
			return nil
		}
	}

	return errors.New("announcement not found")
}

// HasPermission checks if admin has a specific permission
func (s *AdminService) HasPermission(email, permission string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()

	admin, exists := s.admins[email]
	if !exists || !admin.IsActive {
		return false
	}

	for _, p := range admin.Permissions {
		if p == permission || p == "*" {
			return true
		}
	}

	return false
}

// GetAdminStats returns statistics for admin dashboard
func (s *AdminService) GetAdminStats() *AdminStats {
	s.mu.RLock()
	defer s.mu.RUnlock()

	stats := &AdminStats{
		TotalAdmins:    len(s.admins),
		ActiveAdmins:    0,
		AuditLogsCount: len(s.auditLogs),
		AnnouncementsCount: len(s.announcements),
		FeeStructuresCount: len(s.feeStructures),
		AssetsCount: len(s.assets),
	}

	for _, admin := range s.admins {
		if admin.IsActive {
			stats.ActiveAdmins++
		}
	}

	return stats
}

// AdminStats represents admin statistics
type AdminStats struct {
	TotalAdmins       int `json:"total_admins"`
	ActiveAdmins      int `json:"active_admins"`
	AuditLogsCount    int `json:"audit_logs_count"`
	AnnouncementsCount int `json:"announcements_count"`
	FeeStructuresCount int `json:"fee_structures_count"`
	AssetsCount       int `json:"assets_count"`
}

// ApproveUserKYC approves a user's KYC verification
func (s *AdminService) ApproveUserKYC(userID, adminEmail string) error {
	if !s.HasPermission(adminEmail, "kyc.approve") {
		return errors.New("permission denied")
	}

	s.logAction(adminEmail, "kyc_approve", "user", userID, "KYC approved", "", "")
	return nil
}

// RejectUserKYC rejects a user's KYC verification
func (s *AdminService) RejectUserKYC(userID, adminEmail, reason string) error {
	if !s.HasPermission(adminEmail, "kyc.reject") {
		return errors.New("permission denied")
	}

	s.logAction(adminEmail, "kyc_reject", "user", userID, "KYC rejected: "+reason, "", "")
	return nil
}

// FreezeUser freezes a user's account
func (s *AdminService) FreezeUser(userID, adminEmail, reason string) error {
	if !s.HasPermission(adminEmail, "user.freeze") {
		return errors.New("permission denied")
	}

	s.logAction(adminEmail, "user_freeze", "user", userID, "User frozen: "+reason, "", "")
	return nil
}

// UnfreezeUser unfreezes a user's account
func (s *AdminService) UnfreezeUser(userID, adminEmail string) error {
	if !s.HasPermission(adminEmail, "user.freeze") {
		return errors.New("permission denied")
	}

	s.logAction(adminEmail, "user_unfreeze", "user", userID, "User unfrozen", "", "")
	return nil
}

func generateID() string {
	return fmt.Sprintf("ADM_%d_%d", time.Now().UnixNano(), rand.Int63())
}

// InitializeDefaultAdmin initializes default admin account
func (s *AdminService) InitializeDefaultAdmin(email, name string) error {
	return s.CreateAdmin(email, name, RoleSuperAdmin, []string{"*"})
}