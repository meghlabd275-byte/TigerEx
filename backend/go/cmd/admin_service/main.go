package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
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

	// Initialize default super admin
	svc.initDefaultAdmin()
	svc.initDefaultSettings()
	svc.initTradingPairs()
	svc.initFeeConfigs()

	return svc
}

func (s *AdminService) initDefaultAdmin() {
	hash, _ := bcrypt.GenerateFromPassword([]byte("admin123"), bcrypt.DefaultCost)
	
	admin := &Admin{
		ID:          uuid.New().String(),
		Email:       "admin@tigerex.com",
		Username:    "superadmin",
		PasswordHash: string(hash),
		Role:        RoleSuperAdmin,
		Permissions: []string{"*"},
		Status:      "active",
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
	}
	s.admins[admin.ID] = admin
	s.admins[admin.Email] = admin
}

func (s *AdminService) initDefaultSettings() {
	defaults := []*SystemSetting{
		{Key: "platform_name", Value: "TigerEx", Category: "platform", UpdatedAt: time.Now()},
		{Key: "platform_version", Value: "1.0.0", Category: "platform", UpdatedAt: time.Now()},
		{Key: "maintenance_mode", Value: "false", Category: "system", UpdatedAt: time.Now()},
		{Key: "registration_enabled", Value: "true", Category: "users", UpdatedAt: time.Now()},
		{Key: "withdrawal_enabled", Value: "true", Category: "trading", UpdatedAt: time.Now()},
		{Key: "trading_enabled", Value: "true", Category: "trading", UpdatedAt: time.Now()},
		{Key: "p2p_enabled", Value: "true", Category: "trading", UpdatedAt: time.Now()},
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

func (s *AdminService) initTradingPairs() {
	pairs := []*TradingPairConfig{
		{Symbol: "BTC/USDT", BaseAsset: "BTC", QuoteAsset: "USDT", MinPrice: 0.01, MaxPrice: 1000000, TickSize: 0.01, MinQuantity: 0.00001, MaxQuantity: 10000, StepSize: 0.00001, MakerFee: 0.001, TakerFee: 0.001, Status: "trading"},
		{Symbol: "ETH/USDT", BaseAsset: "ETH", QuoteAsset: "USDT", MinPrice: 0.01, MaxPrice: 100000, TickSize: 0.01, MinQuantity: 0.0001, MaxQuantity: 1000000, StepSize: 0.0001, MakerFee: 0.001, TakerFee: 0.001, Status: "trading"},
		{Symbol: "BNB/USDT", BaseAsset: "BNB", QuoteAsset: "USDT", MinPrice: 0.01, MaxPrice: 10000, TickSize: 0.01, MinQuantity: 0.001, MaxQuantity: 1000000, StepSize: 0.001, MakerFee: 0.001, TakerFee: 0.001, Status: "trading"},
		{Symbol: "SOL/USDT", BaseAsset: "SOL", QuoteAsset: "USDT", MinPrice: 0.001, MaxPrice: 10000, TickSize: 0.001, MinQuantity: 0.01, MaxQuantity: 10000000, StepSize: 0.01, MakerFee: 0.001, TakerFee: 0.001, Status: "trading"},
		{Symbol: "XRP/USDT", BaseAsset: "XRP", QuoteAsset: "USDT", MinPrice: 0.0001, MaxPrice: 1000, TickSize: 0.0001, MinQuantity: 1, MaxQuantity: 100000000, StepSize: 1, MakerFee: 0.001, TakerFee: 0.001, Status: "trading"},
		{Symbol: "ADA/USDT", BaseAsset: "ADA", QuoteAsset: "USDT", MinPrice: 0.0001, MaxPrice: 10, TickSize: 0.0001, MinQuantity: 10, MaxQuantity: 100000000, StepSize: 10, MakerFee: 0.001, TakerFee: 0.001, Status: "trading"},
		{Symbol: "DOGE/USDT", BaseAsset: "DOGE", QuoteAsset: "USDT", MinPrice: 0.00001, MaxPrice: 10, TickSize: 0.00001, MinQuantity: 100, MaxQuantity: 1000000000, StepSize: 100, MakerFee: 0.001, TakerFee: 0.001, Status: "trading"},
		{Symbol: "DOT/USDT", BaseAsset: "DOT", QuoteAsset: "USDT", MinPrice: 0.001, MaxPrice: 1000, TickSize: 0.001, MinQuantity: 0.1, MaxQuantity: 10000000, StepSize: 0.1, MakerFee: 0.001, TakerFee: 0.001, Status: "trading"},
	}

	for _, p := range pairs {
		s.tradingPairs[p.Symbol] = p
	}
}

func (s *AdminService) initFeeConfigs() {
	fees := []*FeeConfig{
		{Type: "withdraw", Asset: "BTC", Network: "bitcoin", FeeType: "fixed", FeeAmount: 0.0005, MinFee: 0.0001, MaxFee: 0.001, UpdatedAt: time.Now()},
		{Type: "withdraw", Asset: "ETH", Network: "ethereum", FeeType: "fixed", FeeAmount: 0.005, MinFee: 0.001, MaxFee: 0.01, UpdatedAt: time.Now()},
		{Type: "withdraw", Asset: "USDT", Network: "trc20", FeeType: "percentage", FeeAmount: 1, MinFee: 1, MaxFee: 100, UpdatedAt: time.Now()},
		{Type: "deposit", Asset: "USDT", Network: "trc20", FeeType: "fixed", FeeAmount: 0, MinFee: 0, MaxFee: 0, UpdatedAt: time.Now()},
		{Type: "trade", Asset: "*", Network: "*", FeeType: "percentage", FeeAmount: 0.1, MinFee: 0, MaxFee: 0, UpdatedAt: time.Now()},
		{Type: "transfer", Asset: "*", Network: "*", FeeType: "fixed", FeeAmount: 0.1, MinFee: 0.1, MaxFee: 10, UpdatedAt: time.Now()},
	}

	for _, f := range fees {
		id := fmt.Sprintf("%s_%s_%s", f.Type, f.Asset, f.Network)
		s.feeConfigs[id] = f
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
		if a.Email == email {
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
	session := &AdminSession{
		ID:        uuid.New().String(),
		AdminID:   admin.ID,
		Token:    token,
		ExpiresAt: time.Now().Add(s.config.SessionDuration),
		IPAddress: ipAddress,
		CreatedAt: time.Now(),
	}

	s.sessions[token] = session
	admin.LastLoginAt = &time.Now{}

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

func (s *AdminService) ValidateSession(token string) (*Admin, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	session, ok := s.sessions[token]
	if !ok {
		return nil, APIError{Code: 401, Message: "Invalid session"}
	}

	if session.ExpiresAt.Before(time.Now()) {
		delete(s.sessions, token)
		return nil, APIError{Code: 401, Message: "Session expired"}
	}

	admin, ok := s.admins[session.AdminID]
	if !ok {
		return nil, APIError{Code: 401, Message: "Admin not found"}
	}

	return admin, nil
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
		AdminID string `json:"admin_id" binding:"required"`
		Name    string `json:"name" binding:"required"`
		Domain string `json:"domain" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	wl, err := s.CreateWhiteLabel(req.AdminID, req.Name, req.Domain)
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
		AdminID string `json:"admin_id" binding:"required"`
		Updates map[string]interface{} `json:"updates" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	if err := s.UpdateTradingPair(req.AdminID, symbol, req.Updates); err != nil {
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

	if err := s.UpdateFeeConfig(req.AdminID, feeID, req.Updates); err != nil {
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
		AdminID string `json:"admin_id" binding:"required"`
		Key     string `json:"key" binding:"required"`
		Value   string `json:"value" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	if err := s.UpdateSetting(req.AdminID, req.Key, req.Value); err != nil {
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
	hash := sha256.Sum256([]byte(uuid.New().String() + time.Now().Format(time.RFC3339Nano)))
	return hex.EncodeToString(hash[:])
}

// =============================================================================
// MAIN
// =============================================================================

func main() {
	gin.SetMode(gin.ReleaseMode)

	svc := NewAdminService()

	r := gin.Default()

	// CORS middleware
	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	})

	// Health check
	r.GET("/health", svc.HealthCheck)

	// API routes
	api := r.Group("/api/v1/admin")
	{
		// Auth
		api.POST("/login", svc.LoginHandler)
		api.POST("/logout", svc.LogoutHandler)

		// Dashboard
		api.GET("/dashboard", svc.GetDashboardStatsHandler)

		// White Labels
		api.GET("/white-labels", svc.GetWhiteLabelsHandler)
		api.POST("/white-labels", svc.CreateWhiteLabelHandler)

		// Trading Pairs
		api.GET("/trading-pairs", svc.GetTradingPairsHandler)
		api.PUT("/trading-pairs/:symbol", svc.UpdateTradingPairHandler)

		// Fee Configs
		api.GET("/fees", svc.GetFeeConfigsHandler)
		api.PUT("/fees/:id", svc.UpdateFeeConfigHandler)

		// Settings
		api.GET("/settings", svc.GetSettingsHandler)
		api.PUT("/settings", svc.UpdateSettingHandler)

		// Audit Logs
		api.GET("/audit-logs", svc.GetAuditLogsHandler)
	}

	fmt.Println("Starting Admin Service on :8089")
	r.Run(":8089")
}
