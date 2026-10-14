package admin

import (
	"fmt"
	"strings"
	"sync"
	"time"
)

// =============================================================================
// ADMIN PANEL SERVICE
// User management, trading platform administration
// =============================================================================

// AdminUser admin user
type AdminUser struct {
	ID        string   `json:"id"`
	Email     string   `json:"email"`
	Password  string   `json:"-"`
	Role      string   `json:"role"` // SUPER_ADMIN, COMPLIANCE, SUPPORT, FINANCIAL
	Permissions []string `json:"permissions"`
	LastLogin *time.Time `json:"lastLogin"`
	CreatedAt time.Time `json:"createdAt"`
	IsActive bool      `json:"isActive"`
}

// UserReport user activity report
type UserReport struct {
	UserID   string    `json:"userId"`
	Email    string    `json:"email"`
	KYCLevel int       `json:"kycLevel"`
	Status   string    `json:"status"`
	Deposits float64   `json:"deposits"`
	Withdrawals float64 `json:"withdrawals"`
	Volume   float64   `json:"volume"`
	Trades   int64     `json:"trades"`
	Age      int       `json:"age"` // days since signup
	Flags    []string  `json:"flags"`
}

// AssetReport asset report
type AssetReport struct {
	Asset           string  `json:"asset"`
	Name            string  `json:"name"`
	Deposits        float64 `json:"deposits"`
	Withdrawals    float64 `json:"withdrawals"`
	Volume         float64 `json:"volume"`
	Balance        float64 `json:"balance"`
	ReserveBalance float64 `json:"reserveBalance"`
	CountAddresses int64   `json:"countAddresses"`
}

// OrderReport order report
type OrderReport struct {
	Symbol    string  `json:"symbol"`
	Side     string  `json:"side"`
	Type     string  `json:"type"`
	Count    int64   `json:"count"`
	Volume   float64 `json:"volume"`
	AvgPrice  float64 `json:"avgPrice"`
	FillRate float64 `json:"fillRate"` // % filled
	Cancelled int64  `json:"cancelled"`
}

// AuditLog admin action audit log
type AuditLog struct {
	ID          string    `json:"id"`
	AdminID    string    `json:"adminId"`
	Action     string    `json:"action"`
	TargetUser string    `json:"targetUser,omitempty"`
	TargetType string    `json:"targetType"` // USER, ASSET, ORDER
	Details    string    `json:"details"`
	IPAddress string    `json:"ipAddress"`
	CreatedAt time.Time `json:"createdAt"`
}

// Service admin panel service
type Service struct {
	mu sync.RWMutex

	// Admins
	admins map[string]*AdminUser
	emailToAdmin map[string]string

	// User reports
	userReports map[string]*UserReport
	flaggedUsers map[string][]string // reason -> userIDs

	// Audit
	auditLogs map[string]*AuditLog
	auditIndex map[string][]string // targetID -> auditIDs

	// Config
	RequireApprovalForWithdrawal bool
	RequireApprovalThreshold float64
}

// NewService creates admin service
func NewService() *Service {
	return &Service{
		admins:          make(map[string]*AdminUser),
		emailToAdmin:   make(map[string]string),
		userReports:    make(map[string]*UserReport),
		flaggedUsers:   make(map[string][]string),
		auditLogs:    make(map[string]*AuditLog),
		auditIndex:   make(map[string][]string),
		RequireApprovalForWithdrawal: true,
		RequireApprovalThreshold: 10000,
	}
}

// CreateAdmin creates admin user
func (s *Service) CreateAdmin(admin *AdminUser) error {
	if admin == nil {
		return fmt.Errorf("admin is required")
	}

	// Normalize identifiers before checking uniqueness so differently-cased email
	// addresses cannot create ambiguous login identities.
	candidate := *admin
	candidate.ID = strings.TrimSpace(candidate.ID)
	candidate.Email = strings.ToLower(strings.TrimSpace(candidate.Email))
	if candidate.ID == "" {
		return fmt.Errorf("admin ID required")
	}
	if candidate.Email == "" || !strings.Contains(candidate.Email, "@") {
		return fmt.Errorf("valid admin email required")
	}
	if candidate.Password == "" {
		return fmt.Errorf("admin password required")
	}
	if candidate.Role == "" {
		candidate.Role = "SUPPORT"
	}
	switch candidate.Role {
	case "SUPER_ADMIN", "COMPLIANCE", "SUPPORT", "FINANCIAL":
	default:
		return fmt.Errorf("unsupported admin role")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.admins[candidate.ID]; exists {
		return fmt.Errorf("admin ID already exists")
	}
	if _, exists := s.emailToAdmin[candidate.Email]; exists {
		return fmt.Errorf("admin email already exists")
	}

	candidate.CreatedAt = time.Now()
	candidate.IsActive = true
	candidate.Permissions = append([]string(nil), candidate.Permissions...)
	if candidate.LastLogin != nil {
		lastLogin := *candidate.LastLogin
		candidate.LastLogin = &lastLogin
	}

	// Keep an internal copy; never retain caller-owned pointers or slices.
	stored := candidate
	s.admins[candidate.ID] = &stored
	s.emailToAdmin[candidate.Email] = candidate.ID

	// Reflect normalized server-controlled fields to the caller.
	admin.ID = candidate.ID
	admin.Email = candidate.Email
	admin.Role = candidate.Role
	admin.Permissions = append([]string(nil), candidate.Permissions...)
	admin.CreatedAt = candidate.CreatedAt
	admin.IsActive = candidate.IsActive
	return nil
}

// VerifyAdmin verifies admin credentials
func (s *Service) VerifyAdmin(email, password string) (*AdminUser, error) {
	// LastLogin is mutable state, so use the write lock while validating and updating it.
	s.mu.Lock()
	defer s.mu.Unlock()

	email = strings.ToLower(strings.TrimSpace(email))
	adminID, ok := s.emailToAdmin[email]
	if !ok {
		return nil, fmt.Errorf("admin not found")
	}

	admin := s.admins[adminID]
	if !admin.IsActive {
		return nil, fmt.Errorf("admin disabled")
	}

	if admin.Password != password {
		return nil, fmt.Errorf("invalid credentials")
	}

	now := time.Now()
	admin.LastLogin = &now

	// Return a detached value so callers cannot mutate the service's shared record
	// without holding the service lock.
	result := *admin
	result.Permissions = append([]string(nil), admin.Permissions...)
	if admin.LastLogin != nil {
		lastLogin := *admin.LastLogin
		result.LastLogin = &lastLogin
	}
	return &result, nil
}

// HasPermission checks admin permission
func (s *Service) HasPermission(adminID, permission string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()

	admin, ok := s.admins[adminID]
	if !ok {
		return false
	}

	for _, p := range admin.Permissions {
		if p == permission || p == "*" {
			return true
		}
	}

	return false
}

// GetUsersForApproval gets users needing approval
func (s *Service) GetUsersForApproval(limit int) []*UserReport {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*UserReport
	i := 0
	for _, u := range s.userReports {
		if u.Flags == nil {
			continue
		}
		result = append(result, cloneUserReport(u))
		i++
		if limit > 0 && i >= limit {
			break
		}
	}

	return result
}

// FlagUser flags user for review
func (s *Service) FlagUser(adminID, userID, reason string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	log := &AuditLog{
		ID:        generateAuditID(),
		AdminID:   adminID,
		Action:   "FLAG_USER",
		TargetUser: userID,
		TargetType: "USER",
		Details:  reason,
		CreatedAt: time.Now(),
	}

	s.appendAuditLog(log, userID)

	if s.flaggedUsers[reason] == nil {
		s.flaggedUsers[reason] = make([]string, 0)
	}
	s.flaggedUsers[reason] = append(s.flaggedUsers[reason], userID)

	return nil
}

// UnflagUser removes flag
func (s *Service) UnflagUser(adminID, userID, reason string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	log := &AuditLog{
		ID:        generateAuditID(),
		AdminID:   adminID,
		Action:   "UNFLAG_USER",
		TargetUser: userID,
		TargetType: "USER",
		Details:  reason,
		CreatedAt: time.Now(),
	}

	s.appendAuditLog(log, userID)

	if s.flaggedUsers[reason] == nil {
		return nil
	}

	// Remove from flagged
	newList := make([]string, 0)
	for _, uid := range s.flaggedUsers[reason] {
		if uid != userID {
			newList = append(newList, uid)
		}
	}
	s.flaggedUsers[reason] = newList

	return nil
}

// ApproveUser approves user KYC
func (s *Service) ApproveUser(adminID, userID, level string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	action := "APPROVE_KYC_" + level

	log := &AuditLog{
		ID:         generateAuditID(),
		AdminID:    adminID,
		Action:    action,
		TargetUser: userID,
		TargetType: "USER",
		CreatedAt: time.Now(),
	}

	s.appendAuditLog(log, userID)

	return nil
}

// FreezeUser freezes user account
func (s *Service) FreezeUser(adminID, userID, reason string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	log := &AuditLog{
		ID:         generateAuditID(),
		AdminID:    adminID,
		Action:    "FREEZE_USER",
		TargetUser: userID,
		TargetType: "USER",
		Details:  reason,
		CreatedAt: time.Now(),
	}

	s.appendAuditLog(log, userID)

	return nil
}

// GetAuditLogs gets audit logs
func (s *Service) GetAuditLogs(targetType, targetID string, limit int) []*AuditLog {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if limit <= 0 || strings.TrimSpace(targetID) == "" {
		return nil
	}

	auditIDs := s.auditIndex[targetID]
	if len(auditIDs) == 0 {
		return nil
	}

	result := make([]*AuditLog, 0, limit)
	// Iterate newest-first so a bounded query returns the most recent matching
	// records. Return detached copies so API callers cannot mutate audit history.
	for i := len(auditIDs) - 1; i >= 0 && len(result) < limit; i-- {
		log, ok := s.auditLogs[auditIDs[i]]
		if !ok || (targetType != "" && !strings.EqualFold(log.TargetType, targetType)) {
			continue
		}
		copy := *log
		result = append(result, &copy)
	}
	return result
}

// appendAuditLog records an event and indexes it by its target for audit queries.
// The caller must hold s.mu for writing.
func (s *Service) appendAuditLog(log *AuditLog, targetID string) {
	if log == nil || log.ID == "" {
		return
	}
	s.auditLogs[log.ID] = log
	if targetID != "" {
		s.auditIndex[targetID] = append(s.auditIndex[targetID], log.ID)
	}
}

// GenerateReport generates daily report
func (s *Service) GenerateReport() *Report {
	s.mu.RLock()
	defer s.mu.RUnlock()

	report := &Report{
		GeneratedAt: time.Now(),
		PeriodStart: time.Now().Add(-24 * time.Hour),
		PeriodEnd: time.Now(),
	}

	// Count users
	report.TotalUsers = int64(len(s.userReports))

	// Count admins
	report.TotalAdmins = int64(len(s.admins))

	return report
}

// Report system report
type Report struct {
	GeneratedAt time.Time `json:"generatedAt"`
	PeriodStart time.Time `json:"periodStart"`
	PeriodEnd   time.Time `json:"periodEnd"`

	TotalUsers   int64 `json:"totalUsers"`
	TotalAdmins int64 `json:"totalAdmins"`
	ActiveUsers int64 `json:"activeUsers"`
	NewUsers  int64 `json:"newUsers"`

	TotalDeposits  float64 `json:"totalDeposits"`
	TotalWithdrawal float64 `json:"totalWithdrawals"`
	NetFlow     float64 `json:"netFlow"`

	TotalVolume float64 `json:"totalVolume"`
	TradeCount int64   `json:"tradeCount"`
}

// ToggleAsset toggles asset trading
func (s *Service) ToggleAsset(adminID, asset, status string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	log := &AuditLog{
		ID:         generateAuditID(),
		AdminID:    adminID,
		Action:    "TOGGLE_ASSET",
		TargetType: "ASSET",
		Details:   asset + ":" + status,
		CreatedAt: time.Now(),
	}

	s.appendAuditLog(log, asset)

	return nil
}

// AdjustFee adjusts trading fees
func (s *Service) AdjustFee(adminID, asset string, maker, taker float64) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	details := fmt.Sprintf("%s maker:%.4f taker:%.4f", asset, maker, taker)

	log := &AuditLog{
		ID:         generateAuditID(),
		AdminID:    adminID,
		Action:     "ADJUST_FEE",
		TargetType: "ASSET",
		Details:    details,
		CreatedAt:  time.Now(),
	}

	s.appendAuditLog(log, asset)

	return nil
}

// SearchUsers searches users
func (s *Service) Search_users(query string, limit int) []*UserReport {
	s.mu.RLock()
	defer s.mu.RUnlock()

	query = strings.ToLower(query)
	var results []*UserReport
	count := 0

	for _, u := range s.userReports {
		match := strings.Contains(u.UserID, query) ||
			strings.Contains(strings.ToLower(u.Email), query)

		if match {
			results = append(results, cloneUserReport(u))
			count++
			if limit > 0 && count >= limit {
				break
			}
		}
	}

	return results
}

// cloneUserReport prevents callers from mutating service-owned report state.
func cloneUserReport(report *UserReport) *UserReport {
	if report == nil {
		return nil
	}
	copy := *report
	copy.Flags = append([]string(nil), report.Flags...)
	return &copy
}

func generateAuditID() string {
	return fmt.Sprintf("aud_%d", time.Now().UnixNano())
}