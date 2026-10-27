// TigerEx KYC Service - Production-Grade Identity Verification
// Go-based KYC with AML screening and compliance

package main

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"database/sql"
	"encoding/hex"
	"fmt"
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
	BurstLimit        = 200

	// Document validation
	MinDocumentWidth  = 400
	MinDocumentHeight = 300
	MaxDocumentSize   = 10 * 1024 * 1024 // 10MB

	// KYC tiers
	TierUnverified   = 0
	TierBasic        = 1
	TierIntermediate = 2
	TierFull         = 3

	// Timeout
	RequestTimeout = 30 * time.Second
)

// ============================================================================
// DATA STRUCTURES
// ============================================================================

type (
	// KYC Application
	KYCApplication struct {
		ApplicationID   string `json:"applicationId"`
		UserID          string `json:"userId"`
		Tier            int    `json:"tier"`
		Status          string `json:"status"` // pending, processing, approved, rejected, expired
		FirstName       string `json:"firstName"`
		LastName        string `json:"lastName"`
		DateOfBirth     string `json:"dateOfBirth"`
		Nationality     string `json:"nationality"`
		DocumentType    string `json:"documentType"` // passport, national_id, driver_license
		DocumentNumber  string `json:"documentNumber"`
		DocumentCountry string `json:"documentCountry"`
		Address         string `json:"address"`
		City            string `json:"city"`
		State           string `json:"state"`
		PostalCode      string `json:"postalCode"`
		Country         string `json:"country"`
		IPAddress       string `json:"ipAddress"`
		Fingerprint     string `json:"fingerprint"`
		SelfieVerified  bool   `json:"selfieVerified"`
		LivenessPassed  bool   `json:"livenessPassed"`
		AMLChecked      bool   `json:"amlChecked"`
		AMLResult       string `json:"amlResult"` // clear, review, blocked
		RiskScore       int    `json:"riskScore"` // 0-100
		RejectionReason string `json:"rejectionReason,omitempty"`
		CreatedAt       int64  `json:"createdAt"`
		UpdatedAt       int64  `json:"updatedAt"`
		ApprovedAt      *int64 `json:"approvedAt,omitempty"`
	}

	// Document
	Document struct {
		DocumentID        string  `json:"documentId"`
		ApplicationID     string  `json:"applicationId"`
		DocumentType      string  `json:"documentType"`
		Side              string  `json:"side"` // front, back
		FilePath          string  `json:"filePath"`
		FileHash          string  `json:"fileHash"`
		Verified          bool    `json:"verified"`
		VerificationScore float64 `json:"verificationScore"`
		CreatedAt         int64   `json:"createdAt"`
	}

	// Selfie
	Selfie struct {
		SelfieID       string  `json:"selfieId"`
		ApplicationID  string  `json:"applicationId"`
		FilePath       string  `json:"filePath"`
		FileHash       string  `json:"fileHash"`
		LivenessPassed bool    `json:"livenessPassed"`
		MatchScore     float64 `json:"matchScore"`
		CreatedAt      int64   `json:"createdAt"`
	}

	// AML Check Result
	AMLCheckResult struct {
		CheckID        string   `json:"checkId"`
		ApplicationID  string   `json:"applicationId"`
		Result         string   `json:"result"` // clear, review, blocked
		RiskScore      int      `json:"riskScore"`
		PEPStatus      bool     `json:"pepStatus"` // Politically Exposed Person
		SanctionStatus bool     `json:"sanctionStatus"`
		AdverseMedia   bool     `json:"adverseMedia"`
		Countries      []string `json:"countries"`
		Watchlists     []string `json:"watchlists"`
		CreatedAt      int64    `json:"createdAt"`
	}

	// KYC Tier Limits
	TierLimits struct {
		Tier                 int    `json:"tier"`
		Name                 string `json:"name"`
		DepositLimitDaily    string `json:"depositLimitDaily"`
		WithdrawalLimitDaily string `json:"withdrawalLimitDaily"`
		TradingLimitDaily    string `json:"tradingLimitDaily"`
		RequireSelfie        bool   `json:"requireSelfie"`
		RequireLiveness      bool   `json:"requireLiveness"`
		RequireAML           bool   `json:"requireAML"`
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
		ApplicationID  string `json:"applicationId" binding:"required"`
		DocumentType   string `json:"documentType" binding:"required"`
		Side           string `json:"side" binding:"required"`
		FilePath       string `json:"filePath"`
		FileHash       string `json:"fileHash" binding:"required"`
		DocumentNumber string `json:"documentNumber"`
	}

	// Selfie Upload Request
	SelfieUploadRequest struct {
		ApplicationID string `json:"applicationId" binding:"required"`
		FilePath      string `json:"filePath"`
		FileHash      string `json:"fileHash" binding:"required"`
	}

	// Liveness Request
	LivenessRequest struct {
		ApplicationID string `json:"applicationId" binding:"required"`
		Challenge     string `json:"challenge" binding:"required"` // random challenge for liveness
	}

	// Review Request
	KYCReviewRequest struct {
		ApplicationID string `json:"applicationId" binding:"required"`
		Approved      bool   `json:"approved"`
		Reason        string `json:"reason"`
		Tier          int    `json:"tier"` // tier to grant when Approved is true
	}
)

// ============================================================================
// GLOBAL STATE
// ============================================================================

// Context keys for the authenticated caller.
const (
	ctxUserID   = "userID"
	ctxUserRole = "userRole"
)

var (
	// Database
	db *sql.DB

	// signer verifies access tokens. It must be configured before serving.
	signer *tokenSigner

	// verification is the pluggable document/selfie/AML verifier. When it is
	// nil the service refuses to assert that a document, selfie, or AML check
	// passed.
	verification Verifier

	// piiSecret keys the digest used for document numbers, so a stolen database
	// cannot be brute-forced for the underlying values.
	piiSecret []byte

	// Rate limiting
	rateLimiters   = make(map[string]*rate.Limiter)
	rateLimitersMu sync.RWMutex

	// Request counters
	totalRequests uint64
	rejectedReqs  uint64

	// Document validators
	documentRegex = map[string]*regexp.Regexp{
		"passport":       regexp.MustCompile(`^[A-Z0-9]{6,9}$`),
		"national_id":    regexp.MustCompile(`^[A-Z0-9]{5,20}$`),
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

	// KYC records must survive a restart: a lost application is a compliance
	// failure and a lost audit log is worse. The path is configurable and
	// defaults to a file, never to an in-memory database.
	dsn := os.Getenv("TIGEREX_KYC_DB")
	if dsn == "" {
		dsn = "/var/lib/tigerex/kyc.db"
	}
	if strings.Contains(dsn, ":memory:") {
		return fmt.Errorf("refusing to use an in-memory database for KYC records")
	}

	db, err = sql.Open("sqlite3", dsn)
	if err != nil {
		return fmt.Errorf("failed to open database: %v", err)
	}
	if err := db.Ping(); err != nil {
		return fmt.Errorf("failed to reach database %s: %v", dsn, err)
	}

	// SQLite allows one writer; WAL keeps readers from blocking on it.
	if _, err := db.Exec("PRAGMA journal_mode=WAL"); err != nil {
		return fmt.Errorf("failed to set journal mode: %v", err)
	}
	if _, err := db.Exec("PRAGMA foreign_keys=ON"); err != nil {
		return fmt.Errorf("failed to enable foreign keys: %v", err)
	}

	// Create tables
	if err := createTables(db); err != nil {
		return fmt.Errorf("failed to create tables: %v", err)
	}

	return nil
}

// schemaSQL is the KYC service's schema. It is a constant so tests can build an
// identical database.
const schemaSQL = `
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
	`

// createTables applies the schema to db.
func createTables(db *sql.DB) error {
	_, err := db.Exec(schemaSQL)
	return err
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

func generateID(prefix string) (string, error) {
	suffix, err := randomID(16)
	if err != nil {
		return "", err
	}
	return prefix + "_" + suffix, nil
}

func currentTimestamp() int64 {
	return time.Now().UnixMilli()
}

// isHexDigest reports whether value is a hex-encoded SHA-256 digest (32 bytes).
func isHexDigest(value string) bool {
	trimmed := strings.TrimSpace(value)
	if len(trimmed) != 64 {
		return false
	}
	_, err := hex.DecodeString(trimmed)
	return err == nil
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
	token := bearerToken(c.GetHeader("Authorization"), c.GetHeader("X-API-Key"))
	if token == "" {
		writeError(c, 401, "authentication required")
		c.Abort()
		return
	}

	claims, err := signer.verify(token)
	if err != nil {
		atomic.AddUint64(&rejectedReqs, 1)
		writeError(c, 401, "invalid or expired credentials")
		c.Abort()
		return
	}

	// Rate limit per authenticated subject, not per caller-supplied key.
	if !checkRateLimit(claims.Subject) {
		atomic.AddUint64(&rejectedReqs, 1)
		writeError(c, 429, "Rate limit exceeded")
		c.Abort()
		return
	}

	c.Set(ctxUserID, claims.Subject)
	c.Set(ctxUserRole, claims.Role)
	c.Next()
}

// requireAdmin rejects callers that do not hold the admin role.
func requireAdmin(c *gin.Context) {
	if !isAdmin(c) {
		atomic.AddUint64(&rejectedReqs, 1)
		writeError(c, 403, "administrator privileges required")
		c.Abort()
		return
	}
	c.Next()
}

// currentUserID returns the authenticated subject.
func currentUserID(c *gin.Context) string {
	if v, ok := c.Get(ctxUserID); ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

// isAdmin reports whether the caller holds the admin role.
func isAdmin(c *gin.Context) bool {
	if v, ok := c.Get(ctxUserRole); ok {
		if s, ok := v.(string); ok {
			return s == roleAdmin
		}
	}
	return false
}

// assertApplicationAccess ensures the caller owns the application, or is an
// admin. It prevents one user from reading or mutating another's KYC record.
func assertApplicationAccess(c *gin.Context, applicationID string) error {
	if isAdmin(c) {
		return nil
	}
	var owner string
	err := db.QueryRow("SELECT user_id FROM kyc_applications WHERE application_id = ?",
		applicationID).Scan(&owner)
	if err == sql.ErrNoRows {
		return errNotFound
	}
	if err != nil {
		return errLookupFailed
	}
	if owner != currentUserID(c) {
		return errForbidden
	}
	return nil
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
		writeError(c, 400, "Invalid request")
		return
	}

	// Validate required fields
	if req.FirstName == "" || req.LastName == "" {
		writeError(c, 400, "Name fields are required")
		return
	}

	if !validateDateOfBirth(req.DateOfBirth) {
		writeError(c, 400, "Invalid date of birth or age under 18")
		return
	}

	if !validateDocumentNumber(req.DocumentType, req.DocumentNumber) {
		writeError(c, 400, "Invalid document number format")
		return
	}

	if !validateCountry(req.DocumentCountry) {
		writeError(c, 400, "Unsupported document country")
		return
	}

	if !validatePostalCode(req.PostalCode, req.Country) {
		writeError(c, 400, "Invalid postal code")
		return
	}

	// The applicant is the authenticated subject. An admin may file on behalf of
	// another user by supplying X-User-ID, which is only honoured for admins.
	userID := currentUserID(c)
	if isAdmin(c) {
		if onBehalf := strings.TrimSpace(c.GetHeader("X-User-ID")); onBehalf != "" {
			userID = onBehalf
		}
	}
	if userID == "" {
		writeError(c, 401, "authentication required")
		return
	}

	// Reject a duplicate submission for the same user, which would otherwise
	// create several applications and confuse tier calculation.
	var existing string
	err := db.QueryRow(`SELECT application_id FROM kyc_applications
		WHERE user_id = ? AND status IN ('pending', 'processing')`,
		userID).Scan(&existing)
	if err == nil {
		writeError(c, 409, "An application is already in progress")
		return
	}
	if err != nil && err != sql.ErrNoRows {
		writeError(c, 500, "Database error")
		return
	}

	appID, err := generateID("app")
	if err != nil {
		writeError(c, 500, "Failed to allocate application id")
		return
	}

	now := currentTimestamp()
	app := KYCApplication{
		ApplicationID:   appID,
		UserID:          userID,
		Tier:            TierUnverified,
		Status:          "pending",
		FirstName:       req.FirstName,
		LastName:        req.LastName,
		DateOfBirth:     req.DateOfBirth,
		Nationality:     req.Nationality,
		DocumentType:    req.DocumentType,
		DocumentNumber:  hashPII(piiSecret, req.DocumentNumber),
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

	_, err = db.Exec(`
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

	createAuditLog("kyc_submitted", userID, app.ApplicationID, "KYC application submitted", c.ClientIP())

	writeSuccess(c, gin.H{
		"applicationId": app.ApplicationID,
		"status":        app.Status,
		"tier":          app.Tier,
	})
}

// Get KYC application status
func getApplication(c *gin.Context) {
	appID := c.Param("id")
	if appID == "" {
		writeError(c, 400, "Application ID required")
		return
	}

	// Authorize before reading so a cross-user probe cannot distinguish
	// "not found" from "forbidden" by status code alone.
	if err := assertApplicationAccess(c, appID); err != nil {
		writeErrorForAccess(c, err)
		return
	}

	var app KYCApplication
	err := db.QueryRow(`
		SELECT application_id, user_id, tier, status, first_name, last_name,
		date_of_birth, nationality, document_type, document_number, document_country,
		COALESCE(address, ''), COALESCE(city, ''), COALESCE(state, ''),
		COALESCE(postal_code, ''), COALESCE(country, ''), COALESCE(ip_address, ''),
		selfie_verified, liveness_passed, aml_checked, COALESCE(aml_result, ''),
		risk_score, COALESCE(rejection_reason, ''), created_at, updated_at
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
	// A user may only list their own applications. An admin may list any user's
	// by passing userId.
	userID := currentUserID(c)
	if isAdmin(c) {
		if q := strings.TrimSpace(c.Query("userId")); q != "" {
			userID = q
		}
	}
	if userID == "" {
		writeError(c, 401, "authentication required")
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

	apps := make([]KYCApplication, 0)
	for rows.Next() {
		var app KYCApplication
		err := rows.Scan(
			&app.ApplicationID, &app.UserID, &app.Tier, &app.Status, &app.FirstName,
			&app.LastName, &app.DateOfBirth, &app.Nationality, &app.DocumentType,
			&app.CreatedAt, &app.UpdatedAt,
		)
		if err != nil {
			writeError(c, 500, "Database error")
			return
		}
		apps = append(apps, app)
	}
	if err := rows.Err(); err != nil {
		writeError(c, 500, "Database error")
		return
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

	if err := assertApplicationAccess(c, req.ApplicationID); err != nil {
		writeErrorForAccess(c, err)
		return
	}

	var status string
	err := db.QueryRow("SELECT status FROM kyc_applications WHERE application_id = ?",
		req.ApplicationID).Scan(&status)
	if err == sql.ErrNoRows {
		writeError(c, 404, "Application not found")
		return
	}
	if err != nil {
		writeError(c, 500, "Database error")
		return
	}
	if status != "pending" && status != "processing" {
		writeError(c, 400, "Application not in valid state")
		return
	}

	// The caller references a document already stored by the upload service and
	// passes its content hash so the KYC record is bound to the exact bytes that
	// were verified. No image bytes are accepted or written here.
	if !isHexDigest(req.FileHash) {
		writeError(c, 400, "fileHash must be a hex-encoded SHA-256 digest")
		return
	}

	docID, err := generateID("doc")
	if err != nil {
		writeError(c, 500, "Failed to allocate document id")
		return
	}

	doc := Document{
		DocumentID:    docID,
		ApplicationID: req.ApplicationID,
		DocumentType:  req.DocumentType,
		Side:          req.Side,
		FilePath:      strings.TrimSpace(req.FilePath),
		FileHash:      strings.ToLower(strings.TrimSpace(req.FileHash)),
		Verified:      false,
		CreatedAt:     currentTimestamp(),
	}

	// A document is only marked verified when a verifier is configured and
	// returns a passing score. With no verifier it stays unverified and cannot
	// count toward a tier.
	if verification != nil {
		score, err := verification.VerifyDocument(c.Request.Context(), DocumentCheck{
			ApplicationID:  req.ApplicationID,
			DocumentType:   req.DocumentType,
			Side:           req.Side,
			FilePath:       doc.FilePath,
			FileHash:       doc.FileHash,
			DocumentNumber: req.DocumentNumber,
		})
		if err != nil {
			writeError(c, 502, "Document verification failed")
			return
		}
		doc.VerificationScore = score
		doc.Verified = score >= minDocumentScore
	}

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

	_, err = db.Exec("UPDATE kyc_applications SET updated_at = ? WHERE application_id = ?",
		currentTimestamp(), req.ApplicationID)
	if err != nil {
		writeError(c, 500, "Failed to update application")
		return
	}

	writeSuccess(c, gin.H{
		"documentId":        doc.DocumentID,
		"verified":          doc.Verified,
		"verificationScore": doc.VerificationScore,
	})
}

// Get document
func getDocument(c *gin.Context) {
	docID := c.Param("id")
	if docID == "" {
		writeError(c, 400, "Document ID required")
		return
	}

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
	if err != nil {
		writeError(c, 500, "Database error")
		return
	}

	if err := assertApplicationAccess(c, doc.ApplicationID); err != nil {
		writeErrorForAccess(c, err)
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

	if err := assertApplicationAccess(c, req.ApplicationID); err != nil {
		writeErrorForAccess(c, err)
		return
	}

	var status string
	err := db.QueryRow("SELECT status FROM kyc_applications WHERE application_id = ?",
		req.ApplicationID).Scan(&status)
	if err == sql.ErrNoRows {
		writeError(c, 404, "Application not found")
		return
	}
	if err != nil {
		writeError(c, 500, "Database error")
		return
	}
	if status != "pending" && status != "processing" {
		writeError(c, 400, "Application not in valid state")
		return
	}

	if !isHexDigest(req.FileHash) {
		writeError(c, 400, "fileHash must be a hex-encoded SHA-256 digest")
		return
	}

	selfieID, err := generateID("selfie")
	if err != nil {
		writeError(c, 500, "Failed to allocate selfie id")
		return
	}

	selfie := Selfie{
		SelfieID:       selfieID,
		ApplicationID:  req.ApplicationID,
		FilePath:       strings.TrimSpace(req.FilePath),
		FileHash:       strings.ToLower(strings.TrimSpace(req.FileHash)),
		LivenessPassed: false,
		MatchScore:     0,
		CreatedAt:      currentTimestamp(),
	}

	// A face match is only recorded when a verifier supplies a score.
	if verification != nil {
		score, err := verification.MatchSelfie(c.Request.Context(), SelfieCheck{
			ApplicationID: req.ApplicationID,
			FilePath:      selfie.FilePath,
			FileHash:      selfie.FileHash,
		})
		if err != nil {
			writeError(c, 502, "Selfie verification failed")
			return
		}
		selfie.MatchScore = score
		selfie.LivenessPassed = score >= minSelfieMatchScore
	}

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

	// Only a passing match advances the application.
	if selfie.LivenessPassed {
		_, err = db.Exec(`
			UPDATE kyc_applications
			SET selfie_verified = 1, updated_at = ?
			WHERE application_id = ?
		`, currentTimestamp(), req.ApplicationID)
		if err != nil {
			writeError(c, 500, "Failed to update application")
			return
		}
	}

	writeSuccess(c, gin.H{
		"selfieId":       selfie.SelfieID,
		"livenessPassed": selfie.LivenessPassed,
		"matchScore":     selfie.MatchScore,
	})
}

// Liveness check
func livenessCheck(c *gin.Context) {
	var req LivenessRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, 400, "Invalid request")
		return
	}

	if strings.TrimSpace(req.Challenge) == "" {
		writeError(c, 400, "challenge is required")
		return
	}
	if err := assertApplicationAccess(c, req.ApplicationID); err != nil {
		writeErrorForAccess(c, err)
		return
	}

	// Without a verifier the service cannot assert that liveness passed.
	if verification == nil {
		writeError(c, 503, "liveness verification is not configured")
		return
	}

	passed, err := verification.CheckLiveness(c.Request.Context(), LivenessCheck{
		ApplicationID: req.ApplicationID,
		Challenge:     req.Challenge,
	})
	if err != nil {
		writeError(c, 502, "Liveness verification failed")
		return
	}

	_, err = db.Exec(`
		UPDATE kyc_applications
		SET liveness_passed = ?, updated_at = ?
		WHERE application_id = ?
	`, passed, currentTimestamp(), req.ApplicationID)
	if err != nil {
		writeError(c, 500, "Failed to update liveness")
		return
	}

	writeSuccess(c, gin.H{"livenessPassed": passed})
}

// ============================================================================
// API HANDLERS - AML
// ============================================================================

// Run AML check
func runAMLCheck(c *gin.Context) {
	appID := c.Param("id")
	if appID == "" {
		writeError(c, 400, "Application ID required")
		return
	}

	if err := assertApplicationAccess(c, appID); err != nil {
		writeErrorForAccess(c, err)
		return
	}

	var firstName, lastName, nationality, country string
	err := db.QueryRow(`
		SELECT first_name, last_name, nationality, country
		FROM kyc_applications WHERE application_id = ?
	`, appID).Scan(&firstName, &lastName, &nationality, &country)

	if err == sql.ErrNoRows {
		writeError(c, 404, "Application not found")
		return
	}
	if err != nil {
		writeError(c, 500, "Database error")
		return
	}

	// Screening requires a sanctions/PEP data provider. Returning "clear"
	// without one would let a sanctioned applicant pass.
	if verification == nil {
		writeError(c, 503, "AML screening is not configured")
		return
	}

	checkID, err := generateID("aml")
	if err != nil {
		writeError(c, 500, "Failed to allocate check id")
		return
	}

	result, err := verification.ScreenAML(c.Request.Context(), AMLScreenRequest{
		ApplicationID: appID,
		FirstName:     firstName,
		LastName:      lastName,
		Nationality:   nationality,
		Country:       country,
	})
	if err != nil {
		writeError(c, 502, "AML screening failed")
		return
	}

	amlResult := AMLCheckResult{
		CheckID:        checkID,
		ApplicationID:  appID,
		Result:         result.Result,
		RiskScore:      result.RiskScore,
		PEPStatus:      result.PEPStatus,
		SanctionStatus: result.SanctionStatus,
		AdverseMedia:   result.AdverseMedia,
		Countries:      result.Countries,
		Watchlists:     result.Watchlists,
		CreatedAt:      currentTimestamp(),
	}

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

	_, err = db.Exec(`
		UPDATE kyc_applications
		SET aml_checked = 1, aml_result = ?, risk_score = ?, updated_at = ?
		WHERE application_id = ?
	`, amlResult.Result, amlResult.RiskScore, currentTimestamp(), appID)
	if err != nil {
		writeError(c, 500, "Failed to update application")
		return
	}

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

	var currentStatus, firstName, lastName string
	var selfieVerified, livenessPassed, amlChecked int
	var amlResult string
	err := db.QueryRow(`
		SELECT status, first_name, last_name, selfie_verified, liveness_passed,
		aml_checked, COALESCE(aml_result, '') FROM kyc_applications
		WHERE application_id = ?
	`, req.ApplicationID).Scan(&currentStatus, &firstName, &lastName,
		&selfieVerified, &livenessPassed, &amlChecked, &amlResult)

	if err == sql.ErrNoRows {
		writeError(c, 404, "Application not found")
		return
	}
	if err != nil {
		writeError(c, 500, "Database error")
		return
	}
	if currentStatus != "pending" && currentStatus != "processing" {
		writeError(c, 409, "Application has already been decided")
		return
	}

	// A rejection always applies. An approval requires the checks that the
	// target tier demands, so a tier cannot be granted on an unverified
	// application.
	tier := TierUnverified
	newStatus := "rejected"
	if req.Approved {
		tier, newStatus, err = approvedTierFor(req.Tier, selfieVerified == 1,
			livenessPassed == 1, amlChecked == 1, amlResult)
		if err != nil {
			writeError(c, 409, err.Error())
			return
		}
	}

	now := currentTimestamp()
	_, err = db.Exec(`
		UPDATE kyc_applications
		SET status = ?, tier = ?, rejection_reason = ?, updated_at = ?, approved_at = ?
		WHERE application_id = ?
	`, newStatus, tier, req.Reason, now, now, req.ApplicationID)
	if err != nil {
		writeError(c, 500, "Failed to update application")
		return
	}

	// The reviewer is the authenticated admin, not a client-supplied header.
	reviewerID := currentUserID(c)
	createAuditLog("kyc_reviewed", reviewerID, req.ApplicationID,
		fmt.Sprintf("Application %s: %s", newStatus, req.Reason), c.ClientIP())

	writeSuccess(c, gin.H{
		"applicationId": req.ApplicationID,
		"status":        newStatus,
		"tier":          tier,
	})
}

// approvedTierFor validates that the evidence on the application supports the
// requested tier and returns the tier to grant.
func approvedTierFor(requested int, selfieVerified, livenessPassed, amlChecked bool, amlResult string) (int, string, error) {
	if requested < TierBasic || requested > TierFull {
		return 0, "", fmt.Errorf("requested tier must be between %d and %d", TierBasic, TierFull)
	}
	if amlChecked && amlResult == "blocked" {
		return 0, "", fmt.Errorf("application is blocked by AML screening")
	}
	if !amlChecked {
		return 0, "", fmt.Errorf("AML screening has not been completed")
	}
	if !selfieVerified {
		return 0, "", fmt.Errorf("selfie verification has not passed")
	}
	if requested >= TierIntermediate && !livenessPassed {
		return 0, "", fmt.Errorf("liveness check has not passed")
	}
	return requested, "approved", nil
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
	userID := currentUserID(c)
	if isAdmin(c) {
		if q := strings.TrimSpace(c.Query("userId")); q != "" {
			userID = q
		}
	}
	if userID == "" {
		writeError(c, 401, "authentication required")
		return
	}

	var app KYCApplication
	err := db.QueryRow(`
		SELECT application_id, user_id, tier, status, first_name, last_name,
		date_of_birth, nationality, document_type, document_country,
		selfie_verified, liveness_passed, aml_checked, COALESCE(aml_result, ''),
		risk_score, COALESCE(rejection_reason, ''), created_at, updated_at
		FROM kyc_applications WHERE user_id = ?
		ORDER BY created_at DESC LIMIT 1
	`, userID).Scan(
		&app.ApplicationID, &app.UserID, &app.Tier, &app.Status, &app.FirstName,
		&app.LastName, &app.DateOfBirth, &app.Nationality, &app.DocumentType,
		&app.DocumentCountry, &app.SelfieVerified, &app.LivenessPassed,
		&app.AMLChecked, &app.AMLResult, &app.RiskScore, &app.RejectionReason,
		&app.CreatedAt, &app.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		// No application yet is not an error; report the unverified tier.
		writeSuccess(c, gin.H{
			"userId": userID,
			"tier":   TierUnverified,
			"status": "not_started",
			"limits": tierLimits[TierUnverified],
		})
		return
	}
	if err != nil {
		writeError(c, 500, "Database error")
		return
	}

	limits := tierLimits[TierUnverified]
	if app.Tier >= 0 && app.Tier < len(tierLimits) {
		limits = tierLimits[app.Tier]
	}

	writeSuccess(c, gin.H{
		"userId":        userID,
		"applicationId": app.ApplicationID,
		"tier":          app.Tier,
		"status":        app.Status,
		"limits":        limits,
	})
}

// ============================================================================
// AUDIT LOGGING
// ============================================================================

func createAuditLog(eventType, userID, appID, details, ipAddress string) {
	logID, err := generateID("log")
	if err != nil {
		// An audit log that cannot be written must be visible; the caller's
		// operation still proceeds because the decision is already persisted.
		fmt.Printf("AUDIT LOG ID ALLOCATION FAILED: %s user=%s app=%s\n", eventType, userID, appID)
		return
	}

	_, err = db.Exec(`
		INSERT INTO audit_logs (log_id, event_type, user_id, application_id, details, ip_address, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, logID, eventType, userID, appID, details, ipAddress, currentTimestamp())
	if err != nil {
		fmt.Printf("AUDIT LOG WRITE FAILED: %s user=%s app=%s err=%v\n", eventType, userID, appID, err)
	}
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

	r.Use(gin.Recovery())
	r.Use(loggingMiddleware)
	r.Use(securityMiddleware)

	// Health
	r.GET("/health", healthCheck)

	v1 := r.Group("/api/v1/kyc")
	{
		// Everything below requires a valid token. There is no public
		// endpoint: tier limits are not sensitive but keeping one auth path
		// avoids accidentally exposing a handler.
		v1.Use(authMiddleware)
		{
			v1.GET("/tier-limits", getTierLimits)

			v1.POST("/applications", submitKYC)
			v1.GET("/applications", getUserApplications)
			v1.GET("/applications/:id", getApplication)
			v1.POST("/applications/:id/aml-check", runAMLCheck)

			v1.POST("/documents", uploadDocument)
			v1.GET("/documents/:id", getDocument)

			v1.POST("/selfie", uploadSelfie)
			v1.POST("/liveness", livenessCheck)

			v1.GET("/status", getKYCStatus)

			// Review changes a user's verification tier and must be admin only.
			v1.POST("/applications/:id/review", requireAdmin, reviewApplication)
		}
	}

	return r
}

// ============================================================================
// MAIN
// ============================================================================

func main() {
	fmt.Printf("Starting %s v%s\n", ServiceName, ServiceVersion)

	secret := os.Getenv("TIGEREX_KYC_AUTH_SECRET")
	if secret == "" {
		secret = os.Getenv("TIGEREX_AUTH_SECRET")
	}
	s, err := newTokenSigner(secret, time.Hour)
	if err != nil {
		fmt.Printf("Refusing to start: %v\n", err)
		os.Exit(1)
	}
	signer = s
	piiSecret = []byte(secret)

	// The verifier is optional at the wiring level but its absence means
	// documents, selfies, and AML checks cannot pass.
	if v := os.Getenv("TIGEREX_KYC_VERIFIER_URL"); v != "" {
		verification = NewHTTPVerifier(v)
	}

	if err := initDB(); err != nil {
		fmt.Printf("Failed to initialize database: %v\n", err)
		os.Exit(1)
	}
	defer db.Close()

	router := setupRouter()

	srv := &http.Server{
		Addr:              ":8444",
		Handler:           router,
		ReadTimeout:       RequestTimeout,
		ReadHeaderTimeout: 10 * time.Second,
		WriteTimeout:      RequestTimeout,
		IdleTimeout:       60 * time.Second,
	}

	srv.TLSConfig = &tls.Config{
		MinVersion: tls.VersionTLS12,
	}

	certFile := os.Getenv("TIGEREX_TLS_CERT_FILE")
	keyFile := os.Getenv("TIGEREX_TLS_KEY_FILE")
	if certFile == "" || keyFile == "" {
		fmt.Println("Refusing to start: TIGEREX_TLS_CERT_FILE and TIGEREX_TLS_KEY_FILE are required")
		os.Exit(1)
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		fmt.Printf("KYC Service listening on %s\n", srv.Addr)
		if err := srv.ListenAndServeTLS(certFile, keyFile); err != nil && err != http.ErrServerClosed {
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
