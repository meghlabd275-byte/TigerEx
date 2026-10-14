package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

// =============================================================================
// ERROR TYPES
// =============================================================================

type APIError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (e APIError) Error() string {
	return e.Message
}

// =============================================================================
// DATA TYPES
// =============================================================================

type AdminRole string

const (
	RoleSuperAdmin     AdminRole = "super_admin"
	RoleWhiteLabelAdmin AdminRole = "white_label_admin"
	RoleKYCAdmin      AdminRole = "kyc_admin"
	RoleTradingAdmin  AdminRole = "trading_admin"
	RoleFinanceAdmin  AdminRole = "finance_admin"
	RoleSupportAdmin  AdminRole = "support_admin"
	RoleViewer       AdminRole = "viewer"
)

type Admin struct {
	ID            string      `json:"id"`
	Email         string      `json:"email"`
	Username      string      `json:"username"`
	PasswordHash  string      `json:"-"`
	Role         AdminRole   `json:"role"`
	Permissions  []string    `json:"permissions"`
	WhiteLabelID *string     `json:"white_label_id,omitempty"`
	Status       string      `json:"status"` // "active", "suspended", "inactive"
	LastLoginAt  *time.Time `json:"last_login_at"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

type AdminSession struct {
	ID        string    `json:"id"`
	AdminID   string    `json:"admin_id"`
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
	IPAddress string    `json:"ip_address"`
	CreatedAt time.Time `json:"created_at"`
}

type AuditLog struct {
	ID          string    `json:"id"`
	AdminID    string    `json:"admin_id"`
	Action     string    `json:"action"`
	Resource   string    `json:"resource"`
	ResourceID string    `json:"resource_id"`
	Details    string    `json:"details"`
	IPAddress  string    `json:"ip_address"`
	CreatedAt  time.Time `json:"created_at"`
}

type WhiteLabelClient struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Domain     string    `json:"domain"`
	Branding   string    `json:"branding"`
	Status     string    `json:"status"` // "active", "suspended", "pending"
	Features   []string  `json:"features"`
	Settings   string    `json:"settings"`
	AdminID    string    `json:"admin_id"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type TradingPairConfig struct {
	ID              string  `json:"id"`
	Symbol          string  `json:"symbol"`
	BaseAsset      string  `json:"base_asset"`
	QuoteAsset     string  `json:"quote_asset"`
	MinPrice       float64 `json:"min_price"`
	MaxPrice       float64 `json:"max_price"`
	TickSize        float64 `json:"tick_size"`
	MinQuantity    float64 `json:"min_quantity"`
	MaxQuantity    float64 `json:"max_quantity"`
	StepSize       float64 `json:"step_size"`
	MakerFee       float64 `json:"maker_fee"`
	TakerFee       float64 `json:"taker_fee"`
	Status         string  `json:"status"` // "trading", "halted", "maintenance"
}

type FeeConfig struct {
	ID          string  `json:"id"`
	Type        string  `json:"type"` // "withdraw", "deposit", "trade", "transfer"
	Asset       string  `json:"asset"`
	Network     string  `json:"network"`
	FeeType     string  `json:"fee_type"` // "fixed", "percentage"
	FeeAmount   float64 `json:"fee_amount"`
	MinFee      float64 `json:"min_fee"`
	MaxFee      float64 `json:"max_fee"`
	UpdatedAt   time.Time `json:"updated_at"`
	UpdatedBy   string    `json:"updated_by"`
}

type SystemSetting struct {
	Key         string    `json:"key"`
	Value      string    `json:"value"`
	Category   string    `json:"category"`
	UpdatedAt  time.Time `json:"updated_at"`
	UpdatedBy  string    `json:"updated_by"`
}

// =============================================================================
// ADMIN SERVICE
// =============================================================================

type AdminService struct {
	admins       map[string]*Admin
	sessions     map[string]*AdminSession
	auditLogs    map[string]*AuditLog
	whiteLabels map[string]*WhiteLabelClient
	tradingPairs map[string]*TradingPairConfig
	feeConfigs   map[string]*FeeConfig
	settings    map[string]*SystemSetting
	config      *AdminConfig
	mu          sync.RWMutex
}

type AdminConfig struct {
	SessionDuration time.Duration
	MaxLoginAttempts int
	LockoutDuration time.Duration
}

func NewAdminService() *AdminService {
	svc := &AdminService{
		admins:       make(map[string]*Admin),
		sessions:     make(map[string]*AdminSession),
		auditLogs:    make(map[string]*AuditLog),
		whiteLabels: make(map[string]*WhiteLabelClient),
		tradingPairs: make(map[string]*TradingPairConfig),
		feeConfigs:   make(map[string]*FeeConfig),
		settings:    make(map[string]*SystemSetting),
		config: &AdminConfig{
			SessionDuration: 24 * time.Hour,
			MaxLoginAttempts: 5,
			LockoutDuration: 30 * time.Minute,
		},
	}

	// Bootstrap an administrator only from explicit deployment-provided credentials.
	svc.initBootstrapAdmin()
	svc.initDefaultSettings()
	// Market pairs and fees are not pre-populated with illustrative values; load them from the authoritative configuration service.

	return svc
}

func (s *AdminService) initBootstrapAdmin() {
	email := strings.ToLower(strings.TrimSpace(os.Getenv("TIGEREX_BOOTSTRAP_ADMIN_EMAIL")))
	password := os.Getenv("TIGEREX_BOOTSTRAP_ADMIN_PASSWORD")
	if email == "" || password == "" || len(password) < 16 || !strings.Contains(email, "@") {
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return
	}
	now := time.Now().UTC()
	admin := &Admin{
		ID: uuid.NewString(), Email: email, Username: strings.SplitN(email, "@", 2)[0],
		PasswordHash: string(hash), Role: RoleSuperAdmin, Permissions: []string{"*"},
		Status: "active", CreatedAt: now, UpdatedAt: now,
	}
	s.admins[admin.ID] = admin
	s.admins[admin.Email] = admin
}

func (s *AdminService) initDefaultSettings() {
	defaults := []*SystemSetting{
		{Key: "platform_name", Value: "TigerEx", Category: "platform", UpdatedAt: time.Now()},
		{Key: "platform_version", Value: "1.0.0", Category: "platform", UpdatedAt: time.Now()},
		{Key: "maintenance_mode", Value: "true", Category: "system", UpdatedAt: time.Now()},
		{Key: "registration_enabled", Value: "false", Category: "users", UpdatedAt: time.Now()},
		{Key: "withdrawal_enabled", Value: "false", Category: "trading", UpdatedAt: time.Now()},
		{Key: "trading_enabled", Value: "false", Category: "trading", UpdatedAt: time.Now()},
		{Key: "p2p_enabled", Value: "false", Category: "trading", UpdatedAt: time.Now()},
		{Key: "kyc_required_for_withdrawal", Value: "true", Category: "kyc", UpdatedAt: time.Now()},
		{Key: "default_kyc_level", Value: "1", Category: "kyc", UpdatedAt: time.Now()},
		{Key: "min_withdrawal_amount", Value: "10", Category: "trading", UpdatedAt: time.Now()},
		{Key: "max_withdrawal_amount", Value: "1000000", Category: "trading", UpdatedAt: time.Now()},
		{Key: "withdrawal_lock_period", Value: "48", Category: "security", UpdatedAt: time.Now()},
	}

	for _, setting := range defaults {
		s.settings[setting.Key] = setting
	}
}

// =============================================================================
// ADMIN AUTHENTICATION
// =============================================================================

func (s *AdminService) Login(email, password, ipAddress string) (*Admin, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var admin *Admin
	for _, a := range s.admins {
		if a.Email == strings.ToLower(strings.TrimSpace(email)) {
			admin = a
			break
		}
	}

	if admin == nil {
		return nil, "", APIError{Code: 401, Message: "Invalid credentials"}
	}

	if admin.Status != "active" {
		return nil, "", APIError{Code: 403, Message: "Account is not active"}
	}

	if err := bcrypt.CompareHashAndPassword([]byte(admin.PasswordHash), []byte(password)); err != nil {
		return nil, "", APIError{Code: 401, Message: "Invalid credentials"}
	}

	// Generate session
	token := generateToken()
	if token == "" { return nil, "", APIError{Code: 500, Message: "Could not create secure session token"} }
	session := &AdminSession{
		ID:        uuid.New().String(),
		AdminID:   admin.ID,
		Token:    token,
		ExpiresAt: time.Now().Add(s.config.SessionDuration),
		IPAddress: ipAddress,
		CreatedAt: time.Now(),
	}

	s.sessions[token] = session
	now := time.Now().UTC()
	admin.LastLoginAt = &now

	// Log action
	s.logAction(admin.ID, "login", "admin", admin.ID, "Admin logged in", ipAddress)

	return admin, token, nil
}

func (s *AdminService) Logout(token string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if session, ok := s.sessions[token]; ok {
		delete(s.sessions, token)
		s.logAction(session.AdminID, "logout", "admin", session.AdminID, "Admin logged out", session.IPAddress)
	}
	return nil
}

// AuthMiddleware requires a valid, unexpired session and currently limits this
// legacy in-memory admin service to super-admins until per-action RBAC is wired.
func (s *AdminService) AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"success": false, "error": "authentication required"})
			return
		}
		token := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
		admin, err := s.ValidateSession(token)
		if err != nil || admin == nil || admin.Role != RoleSuperAdmin || admin.Status != "active" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"success": false, "error": "invalid or unauthorized session"})
			return
		}
		c.Set("adminID", admin.ID)
		c.Next()
	}
}

func (s *AdminService) ValidateSession(token string) (*Admin, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	session, ok := s.sessions[token]
	if !ok { return nil, APIError{Code: 401, Message: "Invalid session"} }
	if !session.ExpiresAt.After(time.Now()) {
		delete(s.sessions, token)
		return nil, APIError{Code: 401, Message: "Session expired"}
	}
	admin, ok := s.admins[session.AdminID]
	if !ok || admin.Status != "active" {
		delete(s.sessions, token)
		return nil, APIError{Code: 401, Message: "Admin not found or inactive"}
	}
	copy := *admin
	copy.PasswordHash = ""
	copy.Permissions = append([]string(nil), admin.Permissions...)
	return &copy, nil
}

// =============================================================================
// WHITE LABEL MANAGEMENT
// =============================================================================

func (s *AdminService) CreateWhiteLabel(adminID, name, domain string) (*WhiteLabelClient, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	client := &WhiteLabelClient{
		ID:        uuid.New().String(),
		Name:      name,
		Domain:   domain,
		Branding: "{}",
		Status:    "pending",
		Features: []string{"trading", "wallet", "p2p"},
		Settings: "{}",
		AdminID:  adminID,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	s.whiteLabels[client.ID] = client
	s.logAction(adminID, "create", "white_label", client.ID, "Created white label: "+name, "")

	return client, nil
}

func (s *AdminService) GetWhiteLabels() []*WhiteLabelClient {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*WhiteLabelClient
	for _, wl := range s.whiteLabels {
		result = append(result, wl)
	}
	return result
}

func (s *AdminService) UpdateWhiteLabelStatus(adminID, clientID, status string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	client, ok := s.whiteLabels[clientID]
	if !ok {
		return APIError{Code: 404, Message: "White label not found"}
	}

	client.Status = status
	client.UpdatedAt = time.Now()
	s.logAction(adminID, "update", "white_label", clientID, "Updated status to: "+status, "")

	return nil
}

// =============================================================================
// TRADING PAIRS MANAGEMENT
// =============================================================================

func (s *AdminService) GetTradingPairs() []*TradingPairConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*TradingPairConfig
	for _, p := range s.tradingPairs {
		result = append(result, p)
	}
	return result
}

func (s *AdminService) UpdateTradingPair(adminID, symbol string, updates map[string]interface{}) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	pair, ok := s.tradingPairs[symbol]
	if !ok {
		return APIError{Code: 404, Message: "Trading pair not found"}
	}

	if v, ok := updates["status"].(string); ok {
		pair.Status = v
	}
	if v, ok := updates["maker_fee"].(float64); ok {
		pair.MakerFee = v
	}
	if v, ok := updates["taker_fee"].(float64); ok {
		pair.TakerFee = v
	}
	if v, ok := updates["min_price"].(float64); ok {
		pair.MinPrice = v
	}
	if v, ok := updates["max_price"].(float64); ok {
		pair.MaxPrice = v
	}

	s.logAction(adminID, "update", "trading_pair", symbol, "Updated trading pair settings", "")
	return nil
}

// =============================================================================
// FEE MANAGEMENT
// =============================================================================

func (s *AdminService) GetFeeConfigs() []*FeeConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*FeeConfig
	for _, f := range s.feeConfigs {
		result = append(result, f)
	}
	return result
}

func (s *AdminService) UpdateFeeConfig(adminID, feeID string, updates map[string]interface{}) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	fee, ok := s.feeConfigs[feeID]
	if !ok {
		return APIError{Code: 404, Message: "Fee config not found"}
	}

	if v, ok := updates["fee_amount"].(float64); ok {
		fee.FeeAmount = v
	}
	if v, ok := updates["fee_type"].(string); ok {
		fee.FeeType = v
	}
	if v, ok := updates["min_fee"].(float64); ok {
		fee.MinFee = v
	}
	if v, ok := updates["max_fee"].(float64); ok {
		fee.MaxFee = v
	}

	fee.UpdatedAt = time.Now()
	fee.UpdatedBy = adminID
	s.logAction(adminID, "update", "fee_config", feeID, "Updated fee configuration", "")

	return nil
}

// =============================================================================
// SYSTEM SETTINGS
// =============================================================================

func (s *AdminService) GetSettings() []*SystemSetting {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*SystemSetting
	for _, setting := range s.settings {
		result = append(result, setting)
	}
	return result
}

func (s *AdminService) UpdateSetting(adminID, key, value string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if setting, ok := s.settings[key]; ok {
		setting.Value = value
		setting.UpdatedAt = time.Now()
		setting.UpdatedBy = adminID
	} else {
		s.settings[key] = &SystemSetting{
			Key: key, Value: value, Category: "custom", UpdatedAt: time.Now(), UpdatedBy: adminID,
		}
	}

	s.logAction(adminID, "update", "system_setting", key, "Updated setting: "+key+" = "+value, "")
	return nil
}

// =============================================================================
// AUDIT LOGS
// =============================================================================

func (s *AdminService) logAction(adminID, action, resource, resourceID, details, ipAddress string) {
	log := &AuditLog{
		ID:         uuid.New().String(),
		AdminID:   adminID,
		Action:    action,
		Resource:  resource,
		ResourceID: resourceID,
		Details:   details,
		IPAddress: ipAddress,
		CreatedAt: time.Now(),
	}
	s.auditLogs[log.ID] = log
}

func (s *AdminService) GetAuditLogs(adminID, action, resource string, limit int) []*AuditLog {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*AuditLog
	for _, log := range s.auditLogs {
		if adminID != "" && log.AdminID != adminID {
			continue
		}
		if action != "" && log.Action != action {
			continue
		}
		if resource != "" && log.Resource != resource {
			continue
		}
		result = append(result, log)
	}

	// Sort by date descending
	for i := 0; i < len(result)-1; i++ {
		for j := i + 1; j < len(result); j++ {
			if result[i].CreatedAt.Before(result[j].CreatedAt) {
				result[i], result[j] = result[j], result[i]
			}
		}
	}

	if limit > 0 && limit < len(result) {
		result = result[:limit]
	}

	return result
}

// =============================================================================
// HTTP HANDLERS
// =============================================================================

func (s *AdminService) LoginHandler(c *gin.Context) {
	var req struct {
		Email    string `json:"email" binding:"required"`
		Password string `json:"password" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	clientIP := c.ClientIP()
	admin, token, err := s.Login(req.Email, req.Password, clientIP)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": 401, "message": err.Error()}})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"admin": admin,
			"token": token,
		},
	})
}

func (s *AdminService) LogoutHandler(c *gin.Context) {
	token := c.GetHeader("Authorization")
	if token != "" {
		token = strings.TrimPrefix(token, "Bearer ")
		s.Logout(token)
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (s *AdminService) GetDashboardStatsHandler(c *gin.Context) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	stats := gin.H{
		"total_admins":        len(s.admins),
		"active_sessions":    len(s.sessions),
		"white_labels":       len(s.whiteLabels),
		"trading_pairs":      len(s.tradingPairs),
		"fee_configs":        len(s.feeConfigs),
		"system_settings":    len(s.settings),
		"audit_logs":         len(s.auditLogs),
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": stats})
}

func (s *AdminService) GetWhiteLabelsHandler(c *gin.Context) {
	whiteLabels := s.GetWhiteLabels()
	c.JSON(http.StatusOK, gin.H{"success": true, "data": whiteLabels})
}

func (s *AdminService) CreateWhiteLabelHandler(c *gin.Context) {
	var req struct {
		Name    string `json:"name" binding:"required"`
		Domain string `json:"domain" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	wl, err := s.CreateWhiteLabel(c.GetString("adminID"), req.Name, req.Domain)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"success": true, "data": wl})
}

func (s *AdminService) GetTradingPairsHandler(c *gin.Context) {
	pairs := s.GetTradingPairs()
	c.JSON(http.StatusOK, gin.H{"success": true, "data": pairs})
}

func (s *AdminService) UpdateTradingPairHandler(c *gin.Context) {
	symbol := c.Param("symbol")

	var req struct {
		Updates map[string]interface{} `json:"updates" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	if err := s.UpdateTradingPair(c.GetString("adminID"), symbol, req.Updates); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (s *AdminService) GetFeeConfigsHandler(c *gin.Context) {
	fees := s.GetFeeConfigs()
	c.JSON(http.StatusOK, gin.H{"success": true, "data": fees})
}

func (s *AdminService) UpdateFeeConfigHandler(c *gin.Context) {
	feeID := c.Param("id")

	var req struct {
		AdminID string `json:"admin_id" binding:"required"`
		Updates map[string]interface{} `json:"updates" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	if err := s.UpdateFeeConfig(c.GetString("adminID"), feeID, req.Updates); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (s *AdminService) GetSettingsHandler(c *gin.Context) {
	settings := s.GetSettings()
	c.JSON(http.StatusOK, gin.H{"success": true, "data": settings})
}

func (s *AdminService) UpdateSettingHandler(c *gin.Context) {
	var req struct {
		Key     string `json:"key" binding:"required"`
		Value   string `json:"value" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	if err := s.UpdateSetting(c.GetString("adminID"), req.Key, req.Value); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (s *AdminService) GetAuditLogsHandler(c *gin.Context) {
	adminID := c.Query("admin_id")
	action := c.Query("action")
	resource := c.Query("resource")
	limit := 100

	logs := s.GetAuditLogs(adminID, action, resource, limit)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": logs})
}

func (s *AdminService) HealthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":    "healthy",
		"service":   "admin-service",
		"timestamp": time.Now().Format(time.RFC3339),
	})
}

// =============================================================================
// HELPERS
// =============================================================================

func generateToken() string {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil { return "" }
	return hex.EncodeToString(bytes)
}

// =============================================================================
// MAIN
// =============================================================================

func main() {
	gin.SetMode(gin.ReleaseMode)

	svc := NewAdminService()
	if len(svc.admins) == 0 {
		fmt.Fprintln(os.Stderr, "admin bootstrap required: configure TIGEREX_BOOTSTRAP_ADMIN_EMAIL and TIGEREX_BOOTSTRAP_ADMIN_PASSWORD (16+ characters)")
		os.Exit(1)
	}

	r := gin.Default()

	// CORS only permits an explicitly configured origin; never reflect arbitrary origins.
	r.Use(func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		allowedOrigin := strings.TrimSpace(os.Getenv("ADMIN_CORS_ORIGIN"))
		if origin != "" && (allowedOrigin == "" || origin != allowedOrigin) {
			c.AbortWithStatus(http.StatusForbidden)
			return
		}
		if origin != "" {
			c.Writer.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
			c.Writer.Header().Set("Vary", "Origin")
		}
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if c.Request.Method == "OPTIONS" { c.AbortWithStatus(http.StatusNoContent); return }
		c.Next()
	})

	// Health check
	r.GET("/health", svc.HealthCheck)

	// Login is the only unauthenticated admin endpoint.
	api := r.Group("/api/v1/admin")
	api.POST("/login", svc.LoginHandler)
	protected := api.Group("")
	protected.Use(svc.AuthMiddleware())
	protected.POST("/logout", svc.LogoutHandler)
	protected.GET("/dashboard", svc.GetDashboardStatsHandler)
	protected.GET("/white-labels", svc.GetWhiteLabelsHandler)
	protected.POST("/white-labels", svc.CreateWhiteLabelHandler)
	protected.GET("/trading-pairs", svc.GetTradingPairsHandler)
	protected.PUT("/trading-pairs/:symbol", svc.UpdateTradingPairHandler)
	protected.GET("/fees", svc.GetFeeConfigsHandler)
	protected.PUT("/fees/:id", svc.UpdateFeeConfigHandler)
	protected.GET("/settings", svc.GetSettingsHandler)
	protected.PUT("/settings", svc.UpdateSettingHandler)
	protected.GET("/audit-logs", svc.GetAuditLogsHandler)

	fmt.Println("Starting Admin Service on :8089")
	r.Run(":8089")
}
