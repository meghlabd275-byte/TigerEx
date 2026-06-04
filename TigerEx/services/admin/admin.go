package admin

import (
    "errors"
    "sync"
    "time"
    "crypto/rand"
    "encoding/base64"
    "golang.org/x/crypto/bcrypt"
)

var (
    ErrAdminNotFound     = errors.New("admin not found")
    ErrInvalidCredentials = errors.New("invalid credentials")
    ErrPermissionDenied  = errors.New("permission denied")
)

type AdminRole string

const (
    RoleSuperAdmin   AdminRole = "super_admin"
    RoleAdmin        AdminRole = "admin"
    RoleSupport      AdminRole = "support"
    RoleCompliance   AdminRole = "compliance"
    RoleViewer       AdminRole = "viewer"
)

type AdminUser struct {
    ID           string       `json:"id"`
    Email        string       `json:"email"`
    PasswordHash string       `json:"-"`
    Role         AdminRole    `json:"role"`
    Permissions  []string     `json:"permissions"`
    LastLoginAt  *time.Time   `json:"last_login_at"`
    CreatedAt    time.Time    `json:"created_at"`
}

type AuditLog struct {
    ID          string                 `json:"id"`
    AdminID     string                 `json:"admin_id"`
    Action      string                 `json:"action"`
    TargetType  string                 `json:"target_type"`
    TargetID    string                 `json:"target_id"`
    Details     map[string]interface{} `json:"details"`
    IPAddress   string                 `json:"ip_address"`
    CreatedAt   time.Time              `json:"created_at"`
}

type AdminService struct {
    mu       sync.RWMutex
    admins   map[string]*AdminUser
    sessions map[string]string
    auditLog []*AuditLog
}

func NewAdminService() *AdminService {
    return &AdminService{
        admins:   make(map[string]*AdminUser),
        sessions: make(map[string]string),
        auditLog: make([]*AuditLog, 0),
    }
}

func (s *AdminService) RegisterAdmin(email, password string, role AdminRole) (*AdminUser, error) {
    s.mu.Lock()
    defer s.mu.Unlock()
    
    if _, exists := s.admins[email]; exists {
        return nil, errors.New("admin already exists")
    }
    
    hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
    if err != nil {
        return nil, err
    }
    
    admin := &AdminUser{
        ID:           generateID(),
        Email:        email,
        PasswordHash: string(hash),
        Role:         role,
        Permissions: s.getRolePermissions(role),
        CreatedAt:    time.Now(),
    }
    
    s.admins[email] = admin
    return admin, nil
}

func (s *AdminService) Login(email, password, ipAddress string) (*AdminUser, string, error) {
    s.mu.Lock()
    defer s.mu.Unlock()
    
    admin, exists := s.admins[email]
    if !exists {
        return nil, "", ErrInvalidCredentials
    }
    
    if err := bcrypt.CompareHashAndPassword([]byte(admin.PasswordHash), []byte(password)); err != nil {
        return nil, "", ErrInvalidCredentials
    }
    
    sessionToken := generateToken()
    s.sessions[sessionToken] = admin.ID
    
    now := time.Now()
    admin.LastLoginAt = &now
    
    return admin, sessionToken, nil
}

func (s *AdminService) ValidateSession(token string) (*AdminUser, error) {
    s.mu.RLock()
    adminID, exists := s.sessions[token]
    s.mu.RUnlock()
    
    if !exists {
        return nil, ErrAdminNotFound
    }
    
    s.mu.RLock()
    defer s.mu.RUnlock()
    
    for _, admin := range s.admins {
        if admin.ID == adminID {
            return admin, nil
        }
    }
    
    return nil, ErrAdminNotFound
}

func (s *AdminService) HasPermission(adminID, permission string) bool {
    s.mu.RLock()
    defer s.mu.RUnlock()
    
    for _, admin := range s.admins {
        if admin.ID == adminID {
            for _, p := range admin.Permissions {
                if p == permission || p == "*" {
                    return true
                }
            }
        }
    }
    return false
}

func (s *AdminService) LogAction(adminID, action, targetType, targetID, ipAddress string, details map[string]interface{}) {
    s.mu.Lock()
    defer s.mu.Unlock()
    
    log := &AuditLog{
        ID:         generateID(),
        AdminID:    adminID,
        Action:     action,
        TargetType: targetType,
        TargetID:   targetID,
        Details:    details,
        IPAddress:  ipAddress,
        CreatedAt: time.Now(),
    }
    
    s.auditLog = append(s.auditLog, log)
}

func (s *AdminService) GetAuditLog(limit int) []*AuditLog {
    s.mu.RLock()
    defer s.mu.RUnlock()
    
    if limit > len(s.auditLog) {
        limit = len(s.auditLog)
    }
    
    logs := make([]*AuditLog, limit)
    copy(logs, s.auditLog[len(s.auditLog)-limit:])
    
    return logs
}

func (s *AdminService) GetAuditLogByTarget(targetType, targetID string) []*AuditLog {
    s.mu.RLock()
    defer s.mu.RUnlock()
    
    var logs []*AuditLog
    for _, log := range s.auditLog {
        if log.TargetType == targetType && log.TargetID == targetID {
            logs = append(logs, log)
        }
    }
    return logs
}

func (s *AdminService) SuspendUser(adminID, userID, reason, ipAddress string) error {
    if !s.HasPermission(adminID, "users:suspend") {
        return ErrPermissionDenied
    }
    
    s.LogAction(adminID, "suspend_user", "user", userID, ipAddress, map[string]interface{}{
        "reason": reason,
    })
    
    return nil
}

func (s *AdminService) UpdateMarketStatus(adminID, symbol, status, ipAddress string) error {
    if !s.HasPermission(adminID, "markets:update") {
        return ErrPermissionDenied
    }
    
    s.LogAction(adminID, "update_market_status", "market", symbol, ipAddress, map[string]interface{}{
        "new_status": status,
    })
    
    return nil
}

func (s *AdminService) AdjustFees(adminID, symbol string, makerFee, takerFee float64, ipAddress string) error {
    if !s.HasPermission(adminID, "fees:adjust") {
        return ErrPermissionDenied
    }
    
    s.LogAction(adminID, "adjust_fees", "market", symbol, ipAddress, map[string]interface{}{
        "maker_fee": makerFee,
        "taker_fee": takerFee,
    })
    
    return nil
}

func (s *AdminService) ApproveWithdrawal(adminID, withdrawalID, ipAddress string) error {
    if !s.HasPermission(adminID, "withdrawals:approve") {
        return ErrPermissionDenied
    }
    
    s.LogAction(adminID, "approve_withdrawal", "withdrawal", withdrawalID, ipAddress, nil)
    
    return nil
}

func (s *AdminService) RejectWithdrawal(adminID, withdrawalID, reason, ipAddress string) error {
    if !s.HasPermission(adminID, "withdrawals:reject") {
        return ErrPermissionDenied
    }
    
    s.LogAction(adminID, "reject_withdrawal", "withdrawal", withdrawalID, ipAddress, map[string]interface{}{
        "reason": reason,
    })
    
    return nil
}

func (s *AdminService) getRolePermissions(role AdminRole) []string {
    switch role {
    case RoleSuperAdmin:
        return []string{"*"}
    case RoleAdmin:
        return []string{
            "users:*",
            "markets:*",
            "fees:*",
            "withdrawals:*",
            "audit:*",
        }
    case RoleCompliance:
        return []string{
            "users:view",
            "users:kyc",
            "withdrawals:*",
            "audit:view",
        }
    case RoleSupport:
        return []string{
            "users:view",
            "users:kyc:view",
            "withdrawals:view",
        }
    case RoleViewer:
        return []string{"users:view", "markets:view"}
    default:
        return []string{}
    }
}

func generateID() string {
    b := make([]byte, 16)
    rand.Read(b)
    return base64.URLEncoding.EncodeToString(b)
}

func generateToken() string {
    b := make([]byte, 32)
    rand.Read(b)
    return base64.URLEncoding.EncodeToString(b)
}