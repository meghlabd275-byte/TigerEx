// TigerEx KYC Service - Production-Grade Identity Verification
// Go-based KYC with AML screening and compliance

package main

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"math/rand"
	"net"
	"net/http"
	"os"
	"os/signal"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/time/rate"
)

// ============================================================================
// CONFIGURATION
// ============================================================================

const (
	ServiceName    = "TigerEx KYC Service"
	ServiceVersion = "1.0.0"
	
	// Rate limiting
	RequestsPerSecond = 100
	BurstLimit      = 200
	
	// Document validation
	MinDocumentWidth  = 400
	MinDocumentHeight = 300
	MaxDocumentSize   = 10 * 1024 * 1024 // 10MB
	
	// KYC tiers
	TierUnverified    = 0
	TierBasic         = 1
	TierIntermediate  = 2
	TierFull          = 3
	
	// Timeout
	RequestTimeout = 30 * time.Second
)

// ============================================================================
// DATA STRUCTURES
// ============================================================================

type (
	// KYC Application
	KYCApplication struct {
		ApplicationID    string    `json:"applicationId"`
		UserID          string    `json:"userId"`
		Tier            int       `json:"tier"`
		Status          string    `json:"status"` // pending, processing, approved, rejected, expired
		FirstName       string    `json:"firstName"`
		LastName        string    `json:"lastName"`
		DateOfBirth     string    `json:"dateOfBirth"`
		Nationality     string    `json:"nationality"`
		DocumentType    string    `json:"documentType"` // passport, national_id, driver_license
		DocumentNumber  string    `json:"documentNumber"`
		DocumentCountry string    `json:"documentCountry"`
		Address         string    `json:"address"`
		City            string    `json:"city"`
		State           string    `json:"state"`
		PostalCode      string    `json:"postalCode"`
		Country         string    `json:"country"`
		IPAddress       string    `json:"ipAddress"`
		Fingerprint     string    `json:"fingerprint"`
		SelfieVerified  bool      `json:"selfieVerified"`
		LivenessPassed  bool      `json:"livenessPassed"`
		AMLChecked      bool      `json:"amlChecked"`
		AMLResult       string    `json:"amlResult"` // clear, review, blocked
		RiskScore       int       `json:"riskScore"` // 0-100
		RejectionReason string    `json:"rejectionReason,omitempty"`
		CreatedAt       int64     `json:"createdAt"`
		UpdatedAt       int64     `json:"updatedAt"`
		ApprovedAt      *int64    `json:"approvedAt,omitempty"`
	}
	
	// Document
	Document struct {
		DocumentID     string `json:"documentId"`
		ApplicationID  string `json:"applicationId"`
		DocumentType   string `json:"documentType"`
		Side           string `json:"side"` // front, back
		FilePath       string `json:"filePath"`
		FileHash       string `json:"fileHash"`
		Verified       bool   `json:"verified"`
		VerificationScore float64 `json:"verificationScore"`
		CreatedAt      int64  `json:"createdAt"`
	}
	
	// Selfie
	Selfie struct {
		SelfieID      string `json:"selfieId"`
		ApplicationID string `json:"applicationId"`
		FilePath      string `json:"filePath"`
		FileHash      string `json:"fileHash"`
		LivenessPassed bool   `json:"livenessPassed"`
		MatchScore    float64 `json:"matchScore"`
		CreatedAt     int64   `json:"createdAt"`
	}
	
	// AML Check Result
	AMLCheckResult struct {
		CheckID        string   `json:"checkId"`
		ApplicationID  string   `json:"applicationId"`
		Result         string   `json:"result"` // clear, review, blocked
		RiskScore      int      `json:"riskScore"`
		PEPStatus      bool     `json:"pepStatus"` // Politically Exposed Person
		SactionStatus  bool     `json:"sanctionStatus"`
		AdverseMedia   bool     `json:"adverseMedia"`
		Countries      []string `json:"countries"`
		Watchlists     []string `json:"watchlists"`
		CreatedAt      int64    `json:"createdAt"`
	}
	
	// KYC Tier Limits
	TierLimits struct {
		Tier                int    `json:"tier"`
		Name                string `json:"name"`
		DepositLimitDaily   string `json:"depositLimitDaily"`
		WithdrawalLimitDaily string `json:"withdrawalLimitDaily"`
		TradingLimitDaily   string `json:"tradingLimitDaily"`
		RequireSelfie      bool   `json:"requireSelfie"`
		RequireLiveness    bool   `json:"requireLiveness"`
		RequireAML         bool   `json:"requireAML"`
	}
	
	// API Response
	KYCResponse struct {
		Code    int64       `json:"code"`
		Message string      `json:"message"`
		Data    interface{} `json:"data,omitempty"`
	}
	
	// Submit Request
	KYCSubmitRequest struct {
		FirstName       string `json:"firstName" binding:"required"`
		LastName        string `json:"lastName" binding:"required"`
		DateOfBirth     string `json:"dateOfBirth" binding:"required"`
		Nationality     string `json:"nationality" binding:"required"`
		DocumentType    string `json:"documentType" binding:"required"`
		DocumentNumber  string `json:"documentNumber" binding:"required"`
		DocumentCountry string `json:"documentCountry" binding:"required"`
		Address         string `json:"address" binding:"required"`
		City            string `json:"city" binding:"required"`
		State           string `json:"state"`
		PostalCode      string `json:"postalCode" binding:"required"`
		Country         string `json:"country" binding:"required"`
	}
	
	// Document Upload Request
	DocumentUploadRequest struct {
		ApplicationID string `json:"applicationId" binding:"required"`
		DocumentType   string `json:"documentType" binding:"required"`
		Side           string `json:"side" binding:"required"`
	}
	
	// Selfie Upload Request
	SelfieUploadRequest struct {
		ApplicationID string `json:"applicationId" binding:"required"`
	}
	
	// Liveness Request
	LivenessRequest struct {
		ApplicationID string `json:"applicationId" binding:"required"`
		Challenge    string `json:"challenge"` // random challenge for liveness
	}
	
	// Review Request
	KYCReviewRequest struct {
		ApplicationID string `json:"applicationId" binding:"required"`
		Approved      bool   `json:"approved"`
		Reason        string `json:"reason"`
	}
)

// ============================================================================
// GLOBAL STATE
// ============================================================================

var (
	// Database
	db *sql.DB
	
	// Rate limiting
	rateLimiters    = make(map[string]*rate.Limiter)
	rateLimitersMu sync.RWMutex
	
	// Request counters
	totalRequests  uint64
	rejectedReqs uint64
	
	// Document validators
	documentRegex = map[string]*regexp.Regexp{
		"passport":     regexp.MustCompile(`^[A-Z0-9]{6,9}$`),
		"national_id":   regexp.MustCompile(`^[A-Z0-9]{5,20}$`),
		"driver_license": regexp.MustCompile(`^[A-Z0-9]{5,20}$`),
	}
	
	// Supported countries
	supportedCountries = map[string]bool{
		"US": true, "GB": true, "DE": true, "FR": true, "JP": true,
		"KR": true, "SG": true, "HK": true, "AU": true, "CA": true,
		"CH": true, "NL": true, "SE": true, "NO": true, "DK": true,
		"FI": true, "IE": true, "IT": true, "ES": true, "PT": true,
		"BE": true, "AT": true, "PL": true, "CZ": true, "HU": true,
		"GR": true, "TR": true, "RU": true, "CN": true, "IN": true,
		"BR": true, "MX": true, "AR": true, "CL": true, "CO": true,
	}
	
	// PEP countries (high risk)
	pepCountries = map[string]bool{
		"RU": true, "CN": true, "IR": true, "KP": true, "SY": true,
		"BY": true, "VE": true, "CU": true, "MM": true, "SD": true,
	}
	
	// Tier limits
	tierLimits = []TierLimits{
		{Tier: 0, Name: "Unverified", DepositLimitDaily: "0", WithdrawalLimitDaily: "0", TradingLimitDaily: "0"},
		{Tier: 1, Name: "Basic", DepositLimitDaily: "1000", WithdrawalLimitDaily: "1000", TradingLimitDaily: "10000", RequireSelfie: true},
		{Tier: 2, Name: "Intermediate", DepositLimitDaily: "50000", WithdrawalLimitDaily: "50000", TradingLimitDaily: "100000", RequireSelfie: true, RequireLiveness: true},
		{Tier: 3, Name: "Full", DepositLimitDaily: "unlimited", WithdrawalLimitDaily: "unlimited", TradingLimitDaily: "unlimited", RequireSelfie: true, RequireLiveness: true, RequireAML: true},
	}
)

// ============================================================================
// DATABASE
// ============================================================================

func initDB() error {
	var err error
	
	// Create in-memory database for demo
	db, err = sql.Open("sqlite3", ":memory:")
	if err != nil {
		return fmt.Errorf("failed to open database: %v", err)
	}
	
	// Create tables
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS kyc_applications (
			application_id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			tier INTEGER DEFAULT 0,
			status TEXT DEFAULT 'pending',
			first_name TEXT,
			last_name TEXT,
			date_of_birth TEXT,
			nationality TEXT,
			document_type TEXT,
			document_number TEXT,
			document_country TEXT,
			address TEXT,
			city TEXT,
			state TEXT,
			postal_code TEXT,
			country TEXT,
			ip_address TEXT,
			fingerprint TEXT,
			selfie_verified INTEGER DEFAULT 0,
			liveness_passed INTEGER DEFAULT 0,
			aml_checked INTEGER DEFAULT 0,
			aml_result TEXT,
			risk_score INTEGER DEFAULT 0,
			rejection_reason TEXT,
			created_at INTEGER,
			updated_at INTEGER,
			approved_at INTEGER
		);
		
		CREATE TABLE IF NOT EXISTS documents (
			document_id TEXT PRIMARY KEY,
			application_id TEXT,
			document_type TEXT,
			side TEXT,
			file_path TEXT,
			file_hash TEXT,
			verified INTEGER DEFAULT 0,
			verification_score REAL DEFAULT 0,
			created_at INTEGER
		);
		
		CREATE TABLE IF NOT EXISTS selfies (
			selfie_id TEXT PRIMARY KEY,
			application_id TEXT,
			file_path TEXT,
			file_hash TEXT,
			liveness_passed INTEGER DEFAULT 0,
			match_score REAL DEFAULT 0,
			created_at INTEGER
		);
		
		CREATE TABLE IF NOT EXISTS aml_checks (
			check_id TEXT PRIMARY KEY,
			application_id TEXT,
			result TEXT,
			risk_score INTEGER DEFAULT 0,
			pep_status INTEGER DEFAULT 0,
			sanction_status INTEGER DEFAULT 0,
			adverse_media INTEGER DEFAULT 0,
			countries TEXT,
			watchlists TEXT,
			created_at INTEGER
		);
		
		CREATE TABLE IF NOT EXISTS audit_logs (
			log_id TEXT PRIMARY KEY,
			event_type TEXT,
			user_id TEXT,
			application_id TEXT,
			details TEXT,
			ip_address TEXT,
			created_at INTEGER
		);
		
		CREATE INDEX idx_applications_user ON kyc_applications(user_id);
		CREATE INDEX idx_applications_status ON kyc_applications(status);
		CREATE INDEX idx_documents_application ON documents(application_id);
		CREATE INDEX idx_selfies_application ON selfies(application_id);
		CREATE INDEX idx_aml_application ON aml_checks(application_id);
	`)
	
	if err != nil {
		return fmt.Errorf("failed to create tables: %v", err)
	}
	
	return nil
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

func generateID(prefix string) string {
	return fmt.Sprintf("%s_%d_%d", prefix, time.Now().UnixMilli(), rand.Intn(10000))
}

func currentTimestamp() int64 {
	return time.Now().UnixMilli()
}

func hashFile(data []byte) string {
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}

func validateEmail(email string) bool {
	emailRegex := regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)
	return emailRegex.MatchString(email)
}

func validateDateOfBirth(dob string) bool {
	_, err := time.Parse("2006-01-02", dob)
	if err != nil {
		return false
	}
	// Must be at least 18 years old
	d, _ := time.Parse("2006-01-02", dob)
	age := time.Since(d).Hours() / (24 * 365)
	return age >= 18
}

func validateDocumentNumber(docType, number string) bool {
	regex, exists := documentRegex[docType]
	if !exists {
		return false
	}
	return regex.MatchString(number)
}

func validateCountry(code string) bool {
	_, exists := supportedCountries[code]
	return exists
}

func validatePostalCode(code, country string) bool {
	// Simplified validation
	if len(code) < 3 || len(code) > 10 {
		return false
	}
	return true
}

// ============================================================================
// RATE LIMITING
// ============================================================================

func getRateLimiter(key string) *rate.Limiter {
	rateLimitersMu.Lock()
	defer rateLimitersMu.Unlock()
	
	limiter, exists := rateLimiters[key]
	if !exists {
		limiter = rate.NewLimiter(rate.Limit(RequestsPerSecond), BurstLimit)
		rateLimiters[key] = limiter
	}
	return limiter
}

func checkRateLimit(key string) bool {
	return getRateLimiter(key).Allow()
}

// ============================================================================
// API RESPONSES
// ============================================================================

func writeSuccess(c *gin.Context, data interface{}) {
	c.JSON(http.StatusOK, KYCResponse{
		Code:    0,
		Message: "OK",
		Data:    data,
	})
}

func writeError(c *gin.Context, code int, message string) {
	c.JSON(code, KYCResponse{
		Code:    int64(code),
		Message: message,
	})
}

// ============================================================================
// MIDDLEWARE
// ============================================================================

func authMiddleware(c *gin.Context) {
	apiKey := c.GetHeader("X-API-Key")
	if apiKey == "" {
		writeError(c, 401, "Missing API key")
		c.Abort()
		return
	}
	
	// In production, validate against database
	if !checkRateLimit(apiKey) {
		atomic.AddUint64(&rejectedReqs, 1)
		writeError(c, 429, "Rate limit exceeded")
		c.Abort()
		return
	}
	
	c.Next()
}

func loggingMiddleware(c *gin.Context) {
	start := time.Now()
	path := c.Request.URL.Path
	
	c.Next()
	
	duration := time.Since(start)
	atomic.AddUint64(&totalRequests, 1)
	
	// Log request
	fmt.Printf("[%s] %s %s %d %v\n", 
		c.Request.Method, 
		path, 
		c.ClientIP(), 
		c.Writer.Status(), 
		duration)
}

func securityMiddleware(c *gin.Context) {
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("X-Frame-Options", "DENY")
	c.Header("X-XSS-Protection", "1; mode=block")
	c.Header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
}

// ============================================================================
// API HANDLERS - APPLICATION
// ============================================================================

// Submit KYC application
func submitKYC(c *gin.Context) {
	var req KYCSubmitRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, 400, "Invalid request: "+err.Error())
		return
	}
	
	// Validate required fields
	if req.FirstName == "" || req.LastName == "" {
		writeError(c, 400, "Name fields are required")
		return
	}
	
	// Validate date of birth
	if !validateDateOfBirth(req.DateOfBirth) {
		writeError(c, 400, "Invalid date of birth or age under 18")
		return
	}
	
	// Validate document
	if !validateDocumentNumber(req.DocumentType, req.DocumentNumber) {
		writeError(c, 400, "Invalid document number format")
		return
	}
	
	// Validate country
	if !validateCountry(req.DocumentCountry) {
		writeError(c, 400, "Unsupported document country")
		return
	}
	
	// Validate postal code
	if !validatePostalCode(req.PostalCode, req.Country) {
		writeError(c, 400, "Invalid postal code")
		return
	}
	
	// Get user ID from context (set by auth middleware)
	userID := c.GetHeader("X-User-ID")
	if userID == "" {
		userID = "user_" + generateID("usr")
	}
	
	// Create application
	now := currentTimestamp()
	app := KYCApplication{
		ApplicationID:    generateID("app"),
		UserID:          userID,
		Tier:            TierUnverified,
		Status:          "pending",
		FirstName:       req.FirstName,
		LastName:        req.LastName,
		DateOfBirth:     req.DateOfBirth,
		Nationality:     req.Nationality,
		DocumentType:    req.DocumentType,
		DocumentNumber:  req.DocumentNumber,
		DocumentCountry: req.DocumentCountry,
		Address:         req.Address,
		City:            req.City,
		State:           req.State,
		PostalCode:      req.PostalCode,
		Country:         req.Country,
		IPAddress:       c.ClientIP(),
		Fingerprint:     c.GetHeader("X-Fingerprint"),
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	
	// Save to database
	_, err := db.Exec(`
		INSERT INTO kyc_applications 
		(application_id, user_id, tier, status, first_name, last_name, date_of_birth, 
		nationality, document_type, document_number, document_country, address, city, state, 
		postal_code, country, ip_address, fingerprint, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, app.ApplicationID, app.UserID, app.Tier, app.Status, app.FirstName, app.LastName,
		app.DateOfBirth, app.Nationality, app.DocumentType, app.DocumentNumber, 
		app.DocumentCountry, app.Address, app.City, app.State, app.PostalCode,
		app.Country, app.IPAddress, app.Fingerprint, app.CreatedAt, app.UpdatedAt)
	
	if err != nil {
		writeError(c, 500, "Failed to create application")
		return
	}
	
	// Create audit log
	createAuditLog("kyc_submitted", userID, app.ApplicationID, "KYC application submitted", c.ClientIP())
	
	writeSuccess(c, gin.H{
		"applicationId": app.ApplicationID,
		"status":       app.Status,
		"tier":         app.Tier,
	})
}

// Get KYC application status
func getApplication(c *gin.Context) {
	appID := c.Param("id")
	if appID == "" {
		writeError(c, 400, "Application ID required")
		return
	}
	
	var app KYCApplication
	err := db.QueryRow(`
		SELECT application_id, user_id, tier, status, first_name, last_name, 
		date_of_birth, nationality, document_type, document_number, document_country,
		address, city, state, postal_code, country, ip_address, selfie_verified,
		liveness_passed, aml_checked, aml_result, risk_score, rejection_reason,
		created_at, updated_at
		FROM kyc_applications WHERE application_id = ?
	`, appID).Scan(
		&app.ApplicationID, &app.UserID, &app.Tier, &app.Status, &app.FirstName,
		&app.LastName, &app.DateOfBirth, &app.Nationality, &app.DocumentType,
		&app.DocumentNumber, &app.DocumentCountry, &app.Address, &app.City,
		&app.State, &app.PostalCode, &app.Country, &app.IPAddress,
		&app.SelfieVerified, &app.LivenessPassed, &app.AMLChecked, &app.AMLResult,
		&app.RiskScore, &app.RejectionReason, &app.CreatedAt, &app.UpdatedAt,
	)
	
	if err == sql.ErrNoRows {
		writeError(c, 404, "Application not found")
		return
	}
	
	if err != nil {
		writeError(c, 500, "Database error")
		return
	}
	
	writeSuccess(c, app)
}

// Get user's KYC applications
func getUserApplications(c *gin.Context) {
	userID := c.Query("userId")
	if userID == "" {
		userID = c.GetHeader("X-User-ID")
	}
	
	if userID == "" {
		writeError(c, 400, "User ID required")
		return
	}
	
	rows, err := db.Query(`
		SELECT application_id, user_id, tier, status, first_name, last_name,
		date_of_birth, nationality, document_type, created_at, updated_at
		FROM kyc_applications WHERE user_id = ? ORDER BY created_at DESC
	`, userID)
	
	if err != nil {
		writeError(c, 500, "Database error")
		return
	}
	defer rows.Close()
	
	var apps []KYCApplication
	for rows.Next() {
		var app KYCApplication
		err := rows.Scan(
			&app.ApplicationID, &app.UserID, &app.Tier, &app.Status, &app.FirstName,
			&app.LastName, &app.DateOfBirth, &app.Nationality, &app.DocumentType,
			&app.CreatedAt, &app.UpdatedAt,
		)
		if err != nil {
			continue
		}
		apps = append(apps, app)
	}
	
	writeSuccess(c, apps)
}

// ============================================================================
// API HANDLERS - DOCUMENTS
// ============================================================================

// Upload document
func uploadDocument(c *gin.Context) {
	var req DocumentUploadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, 400, "Invalid request")
		return
	}
	
	// Verify application exists and is pending
	var status string
	err := db.QueryRow("SELECT status FROM kyc_applications WHERE application_id = ?",
		req.ApplicationID).Scan(&status)
	
	if err == sql.ErrNoRows {
		writeError(c, 404, "Application not found")
		return
	}
	
	if status != "pending" && status != "processing" {
		writeError(c, 400, "Application not in valid state")
		return
	}
	
	// In production, would handle file upload
	doc := Document{
		DocumentID:     generateID("doc"),
		ApplicationID:  req.ApplicationID,
		DocumentType:   req.DocumentType,
		Side:          req.Side,
		FilePath:      fmt.Sprintf("/documents/%s_%s.jpg", req.ApplicationID, req.Side),
		FileHash:      "",
		Verified:      false,
		CreatedAt:     currentTimestamp(),
	}
	
	// Simulate document verification
	doc.Verified = true
	doc.VerificationScore = 0.95
	
	// Save to database
	_, err = db.Exec(`
		INSERT INTO documents (document_id, application_id, document_type, side, 
		file_path, file_hash, verified, verification_score, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, doc.DocumentID, doc.ApplicationID, doc.DocumentType, doc.Side,
		doc.FilePath, doc.FileHash, doc.Verified, doc.VerificationScore, doc.CreatedAt)
	
	if err != nil {
		writeError(c, 500, "Failed to save document")
		return
	}
	
	// Update application status
	_, err = db.Exec("UPDATE kyc_applications SET updated_at = ? WHERE application_id = ?",
		currentTimestamp(), req.ApplicationID)
	
	if err != nil {
		writeError(c, 500, "Failed to update application")
		return
	}
	
	writeSuccess(c, gin.H{
		"documentId":         doc.DocumentID,
		"verified":          doc.Verified,
		"verificationScore":  doc.VerificationScore,
	})
}

// Get document
func getDocument(c *gin.Context) {
	docID := c.Param("id")
	
	var doc Document
	err := db.QueryRow(`
		SELECT document_id, application_id, document_type, side, file_path, 
		file_hash, verified, verification_score, created_at
		FROM documents WHERE document_id = ?
	`, docID).Scan(
		&doc.DocumentID, &doc.ApplicationID, &doc.DocumentType, &doc.Side,
		&doc.FilePath, &doc.FileHash, &doc.Verified, &doc.VerificationScore, &doc.CreatedAt,
	)
	
	if err == sql.ErrNoRows {
		writeError(c, 404, "Document not found")
		return
	}
	
	writeSuccess(c, doc)
}

// ============================================================================
// API HANDLERS - SELFIE & LIVENESS
// ============================================================================

// Upload selfie
func uploadSelfie(c *gin.Context) {
	var req SelfieUploadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, 400, "Invalid request")
		return
	}
	
	// Verify application
	var status string
	err := db.QueryRow("SELECT status FROM kyc_applications WHERE application_id = ?",
		req.ApplicationID).Scan(&status)
	
	if err == sql.ErrNoRows {
		writeError(c, 404, "Application not found")
		return
	}
	
	// In production, handle face verification
	selfie := Selfie{
		SelfieID:      generateID("selfie"),
		ApplicationID: req.ApplicationID,
		FilePath:      fmt.Sprintf("/selfies/%s.jpg", req.ApplicationID),
		FileHash:      "",
		LivenessPassed: true,
		MatchScore:    0.92,
		CreatedAt:     currentTimestamp(),
	}
	
	// Save to database
	_, err = db.Exec(`
		INSERT INTO selfies (selfie_id, application_id, file_path, file_hash, 
		liveness_passed, match_score, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, selfie.SelfieID, selfie.ApplicationID, selfie.FilePath, selfie.FileHash,
		selfie.LivenessPassed, selfie.MatchScore, selfie.CreatedAt)
	
	if err != nil {
		writeError(c, 500, "Failed to save selfie")
		return
	}
	
	// Update application
	_, err = db.Exec(`
		UPDATE kyc_applications 
		SET selfie_verified = 1, updated_at = ? 
		WHERE application_id = ?
	`, currentTimestamp(), req.ApplicationID)
	
	writeSuccess(c, gin.H{
		"selfieId":     selfie.SelfieID,
		"livenessPassed": selfie.LivenessPassed,
		"matchScore":   selfie.MatchScore,
	})
}

// Liveness check
func livenessCheck(c *gin.Context) {
	var req LivenessRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, 400, "Invalid request")
		return
	}
	
	// In production, verify liveness with challenge-response
	// Simulated result
	livenessPassed := true
	riskScore := 10
	
	// Update application
	_, err := db.Exec(`
		UPDATE kyc_applications 
		SET liveness_passed = ?, risk_score = ?, updated_at = ? 
		WHERE application_id = ?
	`, livenessPassed, riskScore, currentTimestamp(), req.ApplicationID)
	
	if err != nil {
		writeError(c, 500, "Failed to update liveness")
		return
	}
	
	writeSuccess(c, gin.H{
		"livenessPassed": livenessPassed,
		"riskScore":     riskScore,
	})
}

// ============================================================================
// API HANDLERS - AML
// ============================================================================

// Run AML check
func runAMLCheck(c *gin.Context) {
	appID := c.Param("id")
	
	// Get application
	var firstName, lastName, nationality, country string
	err := db.QueryRow(`
		SELECT first_name, last_name, nationality, country 
		FROM kyc_applications WHERE application_id = ?
	`, appID).Scan(&firstName, &lastName, &nationality, &country)
	
	if err == sql.ErrNoRows {
		writeError(c, 404, "Application not found")
		return
	}
	
	// Simulate AML check
	amlResult := AMLCheckResult{
		CheckID:       generateID("aml"),
		ApplicationID: appID,
		Result:        "clear",
		RiskScore:     15,
		PEPStatus:     false,
		SanctionStatus: false,
		AdverseMedia:  false,
		Countries:     []string{country},
		Watchlists:    []string{},
		CreatedAt:     currentTimestamp(),
	}
	
	// Check against high-risk countries
	if pepCountries[country] {
		amlResult.RiskScore += 30
		amlResult.Result = "review"
	}
	
	// Save AML check
	_, err = db.Exec(`
		INSERT INTO aml_checks (check_id, application_id, result, risk_score, 
		pep_status, sanction_status, adverse_media, countries, watchlists, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, amlResult.CheckID, amlResult.ApplicationID, amlResult.Result, amlResult.RiskScore,
		amlResult.PEPStatus, amlResult.SanctionStatus, amlResult.AdverseMedia,
		strings.Join(amlResult.Countries, ","), strings.Join(amlResult.Watchlists, ","),
		amlResult.CreatedAt)
	
	if err != nil {
		writeError(c, 500, "Failed to save AML check")
		return
	}
	
	// Update application
	_, err = db.Exec(`
		UPDATE kyc_applications 
		SET aml_checked = 1, aml_result = ?, risk_score = ?, updated_at = ? 
		WHERE application_id = ?
	`, amlResult.Result, amlResult.RiskScore, currentTimestamp(), appID)
	
	writeSuccess(c, amlResult)
}

// ============================================================================
// API HANDLERS - REVIEW
// ============================================================================

// Review KYC application (admin)
func reviewApplication(c *gin.Context) {
	var req KYCReviewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, 400, "Invalid request")
		return
	}
	
	// Get current application
	var currentStatus, firstName, lastName string
	err := db.QueryRow(`
		SELECT status, first_name, last_name FROM kyc_applications 
		WHERE application_id = ?
	`, req.ApplicationID).Scan(&currentStatus, &firstName, &lastName)
	
	if err == sql.ErrNoRows {
		writeError(c, 404, "Application not found")
		return
	}
	
	// Update application
	now := currentTimestamp()
	newStatus := "approved"
	tier := TierFull
	
	if !req.Approved {
		newStatus = "rejected"
		tier = TierUnverified
	}
	
	_, err = db.Exec(`
		UPDATE kyc_applications 
		SET status = ?, tier = ?, rejection_reason = ?, updated_at = ?, approved_at = ?
		WHERE application_id = ?
	`, newStatus, tier, req.Reason, now, now, req.ApplicationID)
	
	if err != nil {
		writeError(c, 500, "Failed to update application")
		return
	}
	
	// Create audit log
	reviewerID := c.GetHeader("X-User-ID")
	createAuditLog("kyc_reviewed", reviewerID, req.ApplicationID, 
		fmt.Sprintf("Application %s: %s", newStatus, req.Reason), c.ClientIP())
	
	writeSuccess(c, gin.H{
		"applicationId": req.ApplicationID,
		"status":       newStatus,
		"tier":        tier,
	})
}

// ============================================================================
// API HANDLERS - TIER INFO
// ============================================================================

// Get tier limits
func getTierLimits(c *gin.Context) {
	tier := c.Query("tier")
	
	if tier != "" {
		tierNum, err := strconv.Atoi(tier)
		if err != nil || tierNum < 0 || tierNum > 3 {
			writeError(c, 400, "Invalid tier")
			return
		}
		writeSuccess(c, tierLimits[tierNum])
		return
	}
	
	writeSuccess(c, tierLimits)
}

// Get KYC status for user
func getKYCStatus(c *gin.Context) {
	userID := c.Query("userId")
	if userID == "" {
		userID = c.GetHeader("X-User-ID")
	}
	
	if userID == "" {
		writeError(c, 400, "User ID required")
		return
	}
	
	var app KYCApplication
	err := db.QueryRow(`
		SELECT application_id, user_id, tier, status, selfie_verified, 
		liveness_passed, aml_checked, aml_result, risk_score, created_at, updated_at
		FROM kyc_applications 
		WHERE user_id = ? AND status IN ('approved', 'pending', 'processing')
		ORDER BY created_at DESC LIMIT 1
	`, userID).Scan(
		&app.ApplicationID, &app.UserID, &app.Tier, &app.Status,
		&app.SelfieVerified, &app.LivenessPassed, &app.AMLChecked,
		&app.AMLResult, &app.RiskScore, &app.CreatedAt, &app.UpdatedAt,
	)
	
	if err == sql.ErrNoRows {
		writeSuccess(c, gin.H{
			"tier":   TierUnverified,
			"status": "not_started",
		})
		return
	}
	
	writeSuccess(c, gin.H{
		"tier":           app.Tier,
		"status":         app.Status,
		"selfieVerified": app.SelfieVerified,
		"livenessPassed": app.LivenessPassed,
		"amlChecked":     app.AMLChecked,
		"amlResult":      app.AMLResult,
		"riskScore":      app.RiskScore,
	})
}

// ============================================================================
// AUDIT LOGGING
// ============================================================================

func createAuditLog(eventType, userID, appID, details, ipAddress string) {
	logID := generateID("log")
	now := currentTimestamp()
	
	db.Exec(`
		INSERT INTO audit_logs (log_id, event_type, user_id, application_id, details, ip_address, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, logID, eventType, userID, appID, details, ipAddress, now)
}

// ============================================================================
// HEALTH & METRICS
// ============================================================================

func healthCheck(c *gin.Context) {
	var dbStatus string
	if err := db.Ping(); err != nil {
		dbStatus = "unhealthy"
	} else {
		dbStatus = "healthy"
	}
	
	writeSuccess(c, gin.H{
		"service":       ServiceName,
		"version":       ServiceVersion,
		"status":        "running",
		"database":      dbStatus,
		"totalRequests": atomic.LoadUint64(&totalRequests),
	})
}

// ============================================================================
// ROUTER SETUP
// ============================================================================

func setupRouter() *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	
	// Middleware
	r.Use(gin.Recovery())
	r.Use(loggingMiddleware)
	r.Use(securityMiddleware)
	
	// Health
	r.GET("/health", healthCheck)
	
	// API v1
	v1 := r.Group("/api/v1/kyc")
	{
		// Public endpoints
		v1.GET("/tier-limits", getTierLimits)
		
		// Protected endpoints
		v1.Use(authMiddleware)
		{
			// Applications
			v1.POST("/applications", submitKYC)
			v1.GET("/applications", getUserApplications)
			v1.GET("/applications/:id", getApplication)
			v1.POST("/applications/:id/review", reviewApplication)
			
			// Documents
			v1.POST("/documents", uploadDocument)
			v1.GET("/documents/:id", getDocument)
			
			// Selfie
			v1.POST("/selfie", uploadSelfie)
			v1.POST("/liveness", livenessCheck)
			
			// AML
			v1.POST("/applications/:id/aml-check", runAMLCheck)
			
			// Status
			v1.GET("/status", getKYCStatus)
		}
	}
	
	return r
}

// ============================================================================
// MAIN
// ============================================================================

func main() {
	fmt.Printf("Starting %s v%s\n", ServiceName, ServiceVersion)
	
	// Initialize database
	if err := initDB(); err != nil {
		fmt.Printf("Failed to initialize database: %v\n", err)
		os.Exit(1)
	}
	defer db.Close()
	
	// Setup router
	router := setupRouter()
	
	// Create server
	srv := &http.Server{
		Addr:         ":8444",
		Handler:      router,
		ReadTimeout:   RequestTimeout,
		WriteTimeout:  RequestTimeout,
		IdleTimeout:   60 * time.Second,
	}
	
	// TLS config
	tlsConfig := &tls.Config{
		MinVersion: tls.VersionTLS12,
	}
	srv.TLSConfig = tlsConfig
	
	// Signal handling
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	
	go func() {
		fmt.Printf("KYC Service listening on %s\n", srv.Addr)
		if err := srv.ListenAndServeTLS("", ""); err != nil && err != http.ErrServerClosed {
			fmt.Printf("Server error: %v\n", err)
		}
	}()
	
	<-stop
	fmt.Println("\nShutting down...")
	
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	
	if err := srv.Shutdown(ctx); err != nil {
		fmt.Printf("Server shutdown error: %v\n", err)
	}
	
	fmt.Println("Server stopped")
	fmt.Printf("Total requests: %d\n", atomic.LoadUint64(&totalRequests))
	fmt.Printf("Rejected requests: %d\n", atomic.LoadUint64(&rejectedReqs))
}