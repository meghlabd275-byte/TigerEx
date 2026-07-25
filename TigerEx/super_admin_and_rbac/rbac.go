package rbac

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// ============================================================================
// ROLE-BASED ACCESS CONTROL (RBAC) - PRODUCTION IMPLEMENTATION
// ============================================================================

// Permission represents a specific permission
type Permission string

const (
	// User Management
	PermissionUserRead      Permission = "user:read"
	PermissionUserWrite    Permission = "user:write"
	PermissionUserDelete   Permission = "user:delete"
	PermissionUserBan      Permission = "user:ban"
	
	// Admin Management
	PermissionAdminRead     Permission = "admin:read"
	PermissionAdminWrite   Permission = "admin:write"
	PermissionAdminDelete  Permission = "admin:delete"
	
	// KYC Management
	PermissionKYCRead      Permission = "kyc:read"
	PermissionKYCWrite    Permission = "kyc:write"
	PermissionKYCApprove   Permission = "kyc:approve"
	PermissionKYCReject    Permission = "kyc:reject"
	
	// Trading Pairs
	PermissionPairsRead    Permission = "pairs:read"
	PermissionPairsWrite   Permission = "pairs:write"
	PermissionPairsDelete  Permission = "pairs:delete"
	
	// Fees Management
	PermissionFeesRead     Permission = "fees:read"
	PermissionFeesWrite    Permission = "fees:write"
	
	// Withdrawals
	PermissionWithdrawRead    Permission = "withdraw:read"
	PermissionWithdrawWrite   Permission = "withdraw:write"
	PermissionWithdrawApprove Permission = "withdraw:approve"
	PermissionWithdrawReject  Permission = "withdraw:reject"
	
	// White Label
	PermissionWhiteLabelRead   Permission = "whitelabel:read"
	PermissionWhiteLabelWrite  Permission = "whitelabel:write"
	PermissionWhiteLabelDelete Permission = "whitelabel:delete"
	
	// Blockchain
	PermissionBlockchainRead  Permission = "blockchain:read"
	PermissionBlockchainWrite Permission = "blockchain:write"
	
	// Wallet
	PermissionWalletRead  Permission = "wallet:read"
	PermissionWalletWrite Permission = "wallet:write"
	PermissionWalletAdmin Permission = "wallet:admin"
	
	// Analytics
	PermissionAnalyticsRead Permission = "analytics:read"
	PermissionAnalyticsExport Permission = "analytics:export"
	
	// Reports
	PermissionReportsRead   Permission = "reports:read"
	PermissionReportsWrite Permission = "reports:write"
	
	// Settings
	PermissionSettingsRead  Permission = "settings:read"
	PermissionSettingsWrite Permission = "settings:write"
	
	// Super Admin (all permissions)
	PermissionSuperAdmin Permission = "*"
)

// Role represents an admin role
type Role struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	Description string       `json:"description"`
	Permissions []Permission `json:"permissions"`
	IsSuperAdmin bool       `json:"is_super_admin"`
	IsSystem    bool       `json:"is_system"`
	CreatedAt   int64       `json:"created_at"`
	UpdatedAt   int64       `json:"updated_at"`
	CreatedBy   string      `json:"created_by"`
}

// Admin represents an admin user
type Admin struct {
	ID                string            `json:"id"`
	Email            string            `json:"email"`
	Username         string            `json:"username"`
	PasswordHash     string            `json:"password_hash"`
	RoleID          string            `json:"role_id"`
	FirstName       string            `json:"first_name"`
	LastName        string            `json:"last_name"`
	Phone           string            `json:"phone"`
	Avatar          string            `json:"avatar"`
	IsActive        bool              `json:"is_active"`
	IsSuperAdmin    bool              `json:"is_super_admin"`
	TwoFactorEnabled bool             `json:"two_factor_enabled"`
	TwoFactorSecret string            `json:"two_factor_secret,omitempty"`
	LoginAttempts   int               `json:"login_attempts"`
	LockedUntil    *int64            `json:"locked_until,omitempty"`
	LastLoginAt    *int64            `json:"last_login_at,omitempty"`
	LastLoginIP    string             `json:"last_login_ip"`
	Permissions    []Permission       `json:"permissions,omitempty"`
	Metadata        map[string]string `json:"metadata"`
	CreatedAt       int64             `json:"created_at"`
	UpdatedAt       int64             `json:"updated_at"`
}

// AdminSession represents an admin session
type AdminSession struct {
	ID           string    `json:"id"`
	AdminID      string    `json:"admin_id"`
	Token        string    `json:"token"`
	IPAddress    string    `json:"ip_address"`
	UserAgent    string    `json:"user_agent"`
	ExpiresAt    int64     `json:"expires_at"`
	CreatedAt    int64     `json:"created_at"`
	LastActivity int64     `json:"last_activity"`
	IsActive     bool      `json:"is_active"`
}

// AuditLog represents an admin action audit log
type AuditLog struct {
	ID          string            `json:"id"`
	AdminID     string            `json:"admin_id"`
	AdminEmail  string            `json:"admin_email"`
	Action      string            `json:"action"`
	Resource    string            `json:"resource"`
	ResourceID  string            `json:"resource_id"`
	Details     map[string]interface{} `json:"details"`
	IPAddress   string            `json:"ip_address"`
	UserAgent   string            `json:"user_agent"`
	Timestamp   int64             `json:"timestamp"`
	Result      string            `json:"result"` // success, failure
}

// WhiteLabelClient represents a white label client
type WhiteLabelClient struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Domain      string            `json:"domain"`
	AdminEmail  string            `json:"admin_email"`
	Status      string            `json:"status"` // active, suspended, pending
	RoleID      string            `json:"role_id"`
	Permissions []Permission      `json:"permissions"`
	Config      WhiteLabelConfig  `json:"config"`
	CreatedAt   int64             `json:"created_at"`
	UpdatedAt   int64             `json:"updated_at"`
}

// WhiteLabelConfig contains white label configuration
type WhiteLabelConfig struct {
	BrandName       string `json:"brand_name"`
	BrandLogo       string `json:"brand_logo"`
	BrandColor     string `json:"brand_color"`
	SupportEmail   string `json:"support_email"`
	SupportURL     string `json:"support_url"`
	TermsURL       string `json:"terms_url"`
	PrivacyURL     string `json:"privacy_url"`
	CustomDomain   string `json:"custom_domain"`
	SSLEnabled     bool   `json:"ssl_enabled"`
}

// ============================================================================
// RBAC SERVICE
// ============================================================================

// RBACService manages role-based access control
type RBACService struct {
	roles       map[string]*Role
	admins      map[string]*Admin
	sessions    map[string]*AdminSession
	auditLogs    []AuditLog
	jwtSecret   []byte
	config      *RBACConfig
	
	mu sync.RWMutex `json:"-"`
}

// RBACConfig contains RBAC configuration
type RBACConfig struct {
	JWTExpiration    time.Duration `json:"jwt_expiration"`
	MaxLoginAttempts int           `json:"max_login_attempts"`
	LockoutDuration  time.Duration `json:"lockout_duration"`
	PasswordMinLength int          `json:"password_min_length"`
	SessionTimeout   time.Duration `json:"session_timeout"`
}

// NewRBACService creates a new RBAC service
func NewRBACService(jwtSecret string, config RBACConfig) *RBACService {
	if config.JWTExpiration == 0 {
		config.JWTExpiration = 24 * time.Hour
	}
	if config.MaxLoginAttempts == 0 {
		config.MaxLoginAttempts = 5
	}
	if config.LockoutDuration == 0 {
		config.LockoutDuration = 48 * time.Hour
	}
	if config.PasswordMinLength == 0 {
		config.PasswordMinLength = 12
	}
	if config.SessionTimeout == 0 {
		config.SessionTimeout = 8 * time.Hour
	}
	
	service := &RBACService{
		roles:    make(map[string]*Role),
		admins:   make(map[string]*Admin),
		sessions: make(map[string]*AdminSession),
		auditLogs: make([]AuditLog, 0),
		jwtSecret: []byte(jwtSecret),
		config:   &config,
	}
	
	// Initialize default roles
	service.initializeDefaultRoles()
	
	return service
}

// initializeDefaultRoles creates system default roles
func (s *RBACService) initializeDefaultRoles() {
	// Super Admin role - all permissions
	superAdminRole := &Role{
		ID:          "role_super_admin",
		Name:        "Super Admin",
		Description: "Full system access - can manage all aspects of the platform",
		Permissions: []Permission{PermissionSuperAdmin},
		IsSuperAdmin: true,
		IsSystem:    true,
		CreatedAt:   time.Now().UnixMilli(),
	}
	s.roles[superAdminRole.ID] = superAdminRole
	
	// Platform Admin - all operations except user deletion
	platformAdminRole := &Role{
		ID:          "role_platform_admin",
		Name:        "Platform Admin",
		Description: "Platform-wide administrative access",
		Permissions: []Permission{
			PermissionUserRead, PermissionUserWrite, PermissionUserBan,
			PermissionAdminRead, PermissionAdminWrite,
			PermissionKYCRead, PermissionKYCWrite, PermissionKYCApprove, PermissionKYCReject,
			PermissionPairsRead, PermissionPairsWrite,
			PermissionFeesRead, PermissionFeesWrite,
			PermissionWithdrawRead, PermissionWithdrawWrite, PermissionWithdrawApprove, PermissionWithdrawReject,
			PermissionWhiteLabelRead, PermissionWhiteLabelWrite,
			PermissionBlockchainRead, PermissionBlockchainWrite,
			PermissionWalletRead, PermissionWalletWrite,
			PermissionAnalyticsRead, PermissionAnalyticsExport,
			PermissionReportsRead, PermissionReportsWrite,
			PermissionSettingsRead, PermissionSettingsWrite,
		},
		IsSystem: true,
		CreatedAt: time.Now().UnixMilli(),
	}
	s.roles[platformAdminRole.ID] = platformAdminRole
	
	// KYC Reviewer
	kycReviewerRole := &Role{
		ID:          "role_kyc_reviewer",
		Name:        "KYC Reviewer",
		Description: "Can review and process KYC applications",
		Permissions: []Permission{
			PermissionKYCRead, PermissionKYCWrite, PermissionKYCApprove, PermissionKYCReject,
		},
		IsSystem: true,
		CreatedAt: time.Now().UnixMilli(),
	}
	s.roles[kycReviewerRole.ID] = kycReviewerRole
	
	// Support Agent
	supportRole := &Role{
		ID:          "role_support",
		Name:        "Support Agent",
		Description: "Customer support access",
		Permissions: []Permission{
			PermissionUserRead,
			PermissionKYCRead,
			PermissionWithdrawRead,
			PermissionWalletRead,
			PermissionReportsRead,
		},
		IsSystem: true,
		CreatedAt: time.Now().UnixMilli(),
	}
	s.roles[supportRole.ID] = supportRole
	
	// Finance Admin
	financeRole := &Role{
		ID:          "role_finance",
		Name:        "Finance Admin",
		Description: "Financial operations and withdrawals",
		Permissions: []Permission{
			PermissionWithdrawRead, PermissionWithdrawWrite, PermissionWithdrawApprove, PermissionWithdrawReject,
			PermissionFeesRead, PermissionFeesWrite,
			PermissionAnalyticsRead, PermissionAnalyticsExport,
			PermissionReportsRead, PermissionReportsWrite,
		},
		IsSystem: true,
		CreatedAt: time.Now().UnixMilli(),
	}
	s.roles[financeRole.ID] = financeRole
	
	// White Label Admin
	whiteLabelAdminRole := &Role{
		ID:          "role_whitelabel_admin",
		Name:        "White Label Admin",
		Description: "Admin for white label clients",
		Permissions: []Permission{
			PermissionUserRead, PermissionUserWrite,
			PermissionPairsRead, PermissionPairsWrite,
			PermissionWithdrawRead, PermissionWithdrawWrite,
			PermissionWalletRead, PermissionWalletWrite,
			PermissionAnalyticsRead,
		},
		IsSystem: true,
		CreatedAt: time.Now().UnixMilli(),
	}
	s.roles[whiteLabelAdminRole.ID] = whiteLabelAdminRole
}

// CreateRole creates a new role
func (s *RBACService) CreateRole(ctx context.Context, role *Role, createdBy string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	// Check if role name exists
	for _, r := range s.roles {
		if strings.EqualFold(r.Name, role.Name) {
			return fmt.Errorf("role with name '%s' already exists", role.Name)
		}
	}
	
	// Generate ID if not provided
	if role.ID == "" {
		role.ID = fmt.Sprintf("role_%s", uuid.New().String()[:8])
	}
	
	role.CreatedAt = time.Now().UnixMilli()
	role.UpdatedAt = time.Now().UnixMilli()
	role.CreatedBy = createdBy
	
	s.roles[role.ID] = role
	
	// Log audit
	s.auditLogs = append(s.auditLogs, AuditLog{
		ID:         fmt.Sprintf("audit_%s", uuid.New().String()[:8]),
		AdminID:    createdBy,
		Action:     "create_role",
		Resource:   "role",
		ResourceID: role.ID,
		Details:    map[string]interface{}{"name": role.Name},
		Timestamp:  time.Now().UnixMilli(),
		Result:    "success",
	})
	
	return nil
}

// UpdateRole updates an existing role
func (s *RBACService) UpdateRole(ctx context.Context, roleID string, updates map[string]interface{}, updatedBy string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	role, exists := s.roles[roleID]
	if !exists {
		return fmt.Errorf("role not found: %s", roleID)
	}
	
	if role.IsSystem && !isSuperAdmin(updatedBy) {
		return fmt.Errorf("cannot modify system role")
	}
	
	// Apply updates
	if name, ok := updates["name"].(string); ok {
		role.Name = name
	}
	if desc, ok := updates["description"].(string); ok {
		role.Description = desc
	}
	if perms, ok := updates["permissions"].([]interface{}); ok {
		role.Permissions = make([]Permission, len(perms))
		for i, p := range perms {
			role.Permissions[i] = Permission(p.(string))
		}
	}
	
	role.UpdatedAt = time.Now().UnixMilli()
	
	// Log audit
	s.auditLogs = append(s.auditLogs, AuditLog{
		ID:         fmt.Sprintf("audit_%s", uuid.New().String()[:8]),
		AdminID:    updatedBy,
		Action:     "update_role",
		Resource:   "role",
		ResourceID: roleID,
		Details:    updates,
		Timestamp: time.Now().UnixMilli(),
		Result:    "success",
	})
	
	return nil
}

// DeleteRole deletes a role
func (s *RBACService) DeleteRole(ctx context.Context, roleID, deletedBy string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	role, exists := s.roles[roleID]
	if !exists {
		return fmt.Errorf("role not found: %s", roleID)
	}
	
	if role.IsSystem {
		return fmt.Errorf("cannot delete system role")
	}
	
	// Check if any admin uses this role
	for _, admin := range s.admins {
		if admin.RoleID == roleID {
			return fmt.Errorf("cannot delete role: %d admins assigned", 1)
		}
	}
	
	delete(s.roles, roleID)
	
	// Log audit
	s.auditLogs = append(s.auditLogs, AuditLog{
		ID:         fmt.Sprintf("audit_%s", uuid.New().String()[:8]),
		AdminID:    deletedBy,
		Action:     "delete_role",
		Resource:   "role",
		ResourceID: roleID,
		Timestamp: time.Now().UnixMilli(),
		Result:    "success",
	})
	
	return nil
}

// GetRole returns a role by ID
func (s *RBACService) GetRole(roleID string) (*Role, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	role, exists := s.roles[roleID]
	if !exists {
		return nil, fmt.Errorf("role not found")
	}
	
	return role, nil
}

// GetAllRoles returns all roles
func (s *RBACService) GetAllRoles() []*Role {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	roles := make([]*Role, 0, len(s.roles))
	for _, role := range s.roles {
		roles = append(roles, role)
	}
	
	return roles
}

// ============================================================================
// ADMIN MANAGEMENT
// ============================================================================

// RegisterAdmin creates a new admin user
func (s *RBACService) RegisterAdmin(ctx context.Context, admin *Admin, registeredBy string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	// Validate email
	if admin.Email == "" {
		return fmt.Errorf("email is required")
	}
	
	// Check if email exists
	for _, a := range s.admins {
		if strings.EqualFold(a.Email, admin.Email) {
			return fmt.Errorf("email already registered")
		}
	}
	
	// Check role exists
	if _, exists := s.roles[admin.RoleID]; !exists {
		return fmt.Errorf("role not found: %s", admin.RoleID)
	}
	
	// Generate ID if not provided
	if admin.ID == "" {
		admin.ID = fmt.Sprintf("admin_%s", uuid.New().String()[:8])
	}
	
	// Hash password
	admin.PasswordHash = s.hashPassword(admin.PasswordHash)
	
	admin.CreatedAt = time.Now().UnixMilli()
	admin.UpdatedAt = time.Now().UnixMilli()
	admin.IsActive = true
	
	// Check if super admin role
	role := s.roles[admin.RoleID]
	if role.IsSuperAdmin {
		admin.IsSuperAdmin = true
	}
	
	s.admins[admin.ID] = admin
	
	// Log audit
	s.auditLogs = append(s.auditLogs, AuditLog{
		ID:         fmt.Sprintf("audit_%s", uuid.New().String()[:8]),
		AdminID:    registeredBy,
		Action:     "create_admin",
		Resource:   "admin",
		ResourceID: admin.ID,
		Details:    map[string]interface{}{"email": admin.Email, "role": admin.RoleID},
		Timestamp: time.Now().UnixMilli(),
		Result:    "success",
	})
	
	return nil
}

// AuthenticateAdmin authenticates an admin user
func (s *RBACService) AuthenticateAdmin(ctx context.Context, email, password, ipAddress string) (*AdminSession, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	// Find admin by email
	var admin *Admin
	var adminID string
	for id, a := range s.admins {
		if strings.EqualFold(a.Email, email) {
			admin = a
			adminID = id
			break
		}
	}
	
	if admin == nil {
		return nil, fmt.Errorf("invalid credentials")
	}
	
	// Check if locked
	if admin.LockedUntil != nil && *admin.LockedUntil > time.Now().UnixMilli() {
		return nil, fmt.Errorf("account locked until %s", time.UnixMilli(*admin.LockedUntil).Format(time.RFC3339))
	}
	
	// Verify password
	if !s.verifyPassword(password, admin.PasswordHash) {
		admin.LoginAttempts++
		
		// Lock account after max attempts
		if admin.LoginAttempts >= s.config.MaxLoginAttempts {
			lockedUntil := time.Now().Add(s.config.LockoutDuration).UnixMilli()
			admin.LockedUntil = &lockedUntil
		}
		
		// Log failed attempt
		s.auditLogs = append(s.auditLogs, AuditLog{
			ID:         fmt.Sprintf("audit_%s", uuid.New().String()[:8]),
			AdminID:    adminID,
			Action:     "login_failed",
			Resource:   "admin",
			ResourceID: adminID,
			Details:    map[string]interface{}{"reason": "invalid_password", "attempts": admin.LoginAttempts},
			IPAddress:  ipAddress,
			Timestamp: time.Now().UnixMilli(),
			Result:    "failure",
		})
		
		return nil, fmt.Errorf("invalid credentials")
	}
	
	// Reset login attempts
	admin.LoginAttempts = 0
	admin.LockedUntil = nil
	
	now := time.Now().UnixMilli()
	admin.LastLoginAt = &now
	admin.LastLoginIP = ipAddress
	
	// Create session
	session := &AdminSession{
		ID:           fmt.Sprintf("session_%s", uuid.New().String()[:12]),
		AdminID:      adminID,
		Token:        s.generateToken(adminID),
		IPAddress:    ipAddress,
		ExpiresAt:    time.Now().Add(s.config.JWTExpiration).UnixMilli(),
		CreatedAt:    now,
		LastActivity: now,
		IsActive:     true,
	}
	
	s.sessions[session.Token] = session
	
	// Log successful login
	s.auditLogs = append(s.auditLogs, AuditLog{
		ID:         fmt.Sprintf("audit_%s", uuid.New().String()[:8]),
		AdminID:    adminID,
		Action:     "login_success",
		Resource:   "admin",
		ResourceID: adminID,
		IPAddress:  ipAddress,
		Timestamp:  now,
		Result:    "success",
	})
	
	return session, nil
}

// ValidateSession validates an admin session
func (s *RBACService) ValidateSession(ctx context.Context, token string) (*Admin, error) {
	s.mu.RLock()
	session, exists := s.sessions[token]
	s.mu.RUnlock()
	
	if !exists || !session.IsActive {
		return nil, fmt.Errorf("invalid session")
	}
	
	// Check expiration
	if session.ExpiresAt < time.Now().UnixMilli() {
		s.mu.Lock()
		session.IsActive = false
		s.mu.Unlock()
		return nil, fmt.Errorf("session expired")
	}
	
	// Update last activity
	session.LastActivity = time.Now().UnixMilli()
	
	// Get admin
	s.mu.RLock()
	admin := s.admins[session.AdminID]
	s.mu.RUnlock()
	
	if admin == nil || !admin.IsActive {
		return nil, fmt.Errorf("admin not found or inactive")
	}
	
	return admin, nil
}

// Logout invalidates a session
func (s *RBACService) Logout(ctx context.Context, token string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	session, exists := s.sessions[token]
	if !exists {
		return fmt.Errorf("session not found")
	}
	
	session.IsActive = false
	delete(s.sessions, token)
	
	return nil
}

// HasPermission checks if admin has a specific permission
func (s *RBACService) HasPermission(ctx context.Context, adminID string, permission Permission) bool {
	s.mu.RLock()
	admin, exists := s.admins[adminID]
	s.mu.RUnlock()
	
	if !exists || !admin.IsActive {
		return false
	}
	
	// Super admin has all permissions
	if admin.IsSuperAdmin {
		return true
	}
	
	// Get role
	s.mu.RLock()
	role, roleExists := s.roles[admin.RoleID]
	s.mu.RUnlock()
	
	if !roleExists {
		return false
	}
	
	// Super admin role has all permissions
	if role.IsSuperAdmin {
		return true
	}
	
	// Check if permission exists in role
	for _, p := range role.Permissions {
		if p == PermissionSuperAdmin || p == permission {
			return true
		}
	}
	
	// Check custom permissions
	for _, p := range admin.Permissions {
		if p == PermissionSuperAdmin || p == permission {
			return true
		}
	}
	
	return false
}

// GetAdmin returns admin by ID
func (s *RBACService) GetAdmin(adminID string) (*Admin, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	admin, exists := s.admins[adminID]
	if !exists {
		return nil, fmt.Errorf("admin not found")
	}
	
	return admin, nil
}

// UpdateAdmin updates admin details
func (s *RBACService) UpdateAdmin(ctx context.Context, adminID string, updates map[string]interface{}, updatedBy string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	admin, exists := s.admins[adminID]
	if !exists {
		return fmt.Errorf("admin not found")
	}
	
	// Apply updates
	if firstName, ok := updates["first_name"].(string); ok {
		admin.FirstName = firstName
	}
	if lastName, ok := updates["last_name"].(string); ok {
		admin.LastName = lastName
	}
	if phone, ok := updates["phone"].(string); ok {
		admin.Phone = phone
	}
	if roleID, ok := updates["role_id"].(string); ok {
		// Verify role exists
		if _, roleExists := s.roles[roleID]; !roleExists {
			return fmt.Errorf("role not found")
		}
		admin.RoleID = roleID
	}
	
	admin.UpdatedAt = time.Now().UnixMilli()
	
	// Log audit
	s.auditLogs = append(s.auditLogs, AuditLog{
		ID:         fmt.Sprintf("audit_%s", uuid.New().String()[:8]),
		AdminID:    updatedBy,
		Action:     "update_admin",
		Resource:   "admin",
		ResourceID: adminID,
		Details:    updates,
		Timestamp: time.Now().UnixMilli(),
		Result:    "success",
	})
	
	return nil
}

// DeactivateAdmin deactivates an admin account
func (s *RBACService) DeactivateAdmin(ctx context.Context, adminID, deactivatedBy string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	admin, exists := s.admins[adminID]
	if !exists {
		return fmt.Errorf("admin not found")
	}
	
	admin.IsActive = false
	admin.UpdatedAt = time.Now().UnixMilli()
	
	// Log audit
	s.auditLogs = append(s.auditLogs, AuditLog{
		ID:         fmt.Sprintf("audit_%s", uuid.New().String()[:8]),
		AdminID:    deactivatedBy,
		Action:     "deactivate_admin",
		Resource:   "admin",
		ResourceID: adminID,
		Timestamp: time.Now().UnixMilli(),
		Result:    "success",
	})
	
	return nil
}

// GetAuditLogs returns audit logs
func (s *RBACService) GetAuditLogs(ctx context.Context, adminID string, limit int) []AuditLog {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	logs := make([]AuditLog, 0)
	count := 0
	
	for i := len(s.auditLogs) - 1; i >= 0 && count < limit; i-- {
		if adminID == "" || s.auditLogs[i].AdminID == adminID {
			logs = append(logs, s.auditLogs[i])
			count++
		}
	}
	
	return logs
}

// ============================================================================
// WHITE LABEL MANAGEMENT
// ============================================================================

// WhiteLabelClients stores white label clients
var whiteLabelClients = make(map[string]*WhiteLabelClient)

// CreateWhiteLabelClient creates a white label client
func (s *RBACService) CreateWhiteLabelClient(ctx context.Context, client *WhiteLabelClient, createdBy string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	if client.ID == "" {
		client.ID = fmt.Sprintf("wl_%s", uuid.New().String()[:8])
	}
	
	client.CreatedAt = time.Now().UnixMilli()
	client.UpdatedAt = time.Now().UnixMilli()
	client.Status = "pending"
	
	whiteLabelClients[client.ID] = client
	
	// Log audit
	s.auditLogs = append(s.auditLogs, AuditLog{
		ID:         fmt.Sprintf("audit_%s", uuid.New().String()[:8]),
		AdminID:    createdBy,
		Action:     "create_whitelabel",
		Resource:   "whitelabel",
		ResourceID: client.ID,
		Details:    map[string]interface{}{"name": client.Name, "domain": client.Domain},
		Timestamp: time.Now().UnixMilli(),
		Result:    "success",
	})
	
	return nil
}

// GetWhiteLabelClient returns a white label client
func (s *RBACService) GetWhiteLabelClient(clientID string) (*WhiteLabelClient, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	client, exists := whiteLabelClients[clientID]
	if !exists {
		return nil, fmt.Errorf("white label client not found")
	}
	
	return client, nil
}

// UpdateWhiteLabelClient updates white label client
func (s *RBACService) UpdateWhiteLabelClient(ctx context.Context, clientID string, updates map[string]interface{}, updatedBy string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	client, exists := whiteLabelClients[clientID]
	if !exists {
		return fmt.Errorf("white label client not found")
	}
	
	// Apply updates
	if name, ok := updates["name"].(string); ok {
		client.Name = name
	}
	if domain, ok := updates["domain"].(string); ok {
		client.Domain = domain
	}
	if status, ok := updates["status"].(string); ok {
		client.Status = status
	}
	
	client.UpdatedAt = time.Now().UnixMilli()
	
	return nil
}

// ============================================================================
// HELPER METHODS
// ============================================================================

// hashPassword creates a hash of the password
func (s *RBACService) hashPassword(password string) string {
	hash := sha256.Sum256([]byte(password))
	return hex.EncodeToString(hash[:])
}

// verifyPassword verifies a password against its hash
func (s *RBACService) verifyPassword(password, hash string) bool {
	return s.hashPassword(password) == hash
}

// generateToken generates a JWT token
func (s *RBACService) generateToken(adminID string) string {
	claims := jwt.MapClaims{
		"admin_id": adminID,
		"exp":      time.Now().Add(s.config.JWTExpiration).Unix(),
		"iat":      time.Now().Unix(),
	}
	
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, _ := token.SignedString(s.jwtSecret)
	
	return tokenString
}

// isSuperAdmin checks if admin is super admin (simplified)
func isSuperAdmin(adminID string) bool {
	// In production, would check admin role/permissions
	return adminID == "admin_super"
}

// ============================================================================
// PERMISSION UTILITY
// ============================================================================

// PermissionSet represents a set of permissions
type PermissionSet map[Permission]bool

// NewPermissionSet creates a new permission set
func NewPermissionSet(permissions ...Permission) PermissionSet {
	ps := make(PermissionSet)
	for _, p := range permissions {
		ps[p] = true
	}
	return ps
}

// Has checks if permission set has a permission
func (ps PermissionSet) Has(permission Permission) bool {
	_, ok := ps[PermissionSuperAdmin]
	if ok {
		return true
	}
	_, ok = ps[permission]
	return ok
}

// Add adds a permission to the set
func (ps PermissionSet) Add(permission Permission) {
	ps[permission] = true
}

// Remove removes a permission from the set
func (ps PermissionSet) Remove(permission Permission) {
	delete(ps, permission)
}

// ToSlice converts permission set to slice
func (ps PermissionSet) ToSlice() []Permission {
	permissions := make([]Permission, 0, len(ps))
	for p := range ps {
		permissions = append(permissions, p)
	}
	return permissions
}
