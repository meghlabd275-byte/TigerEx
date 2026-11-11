// HTTP Handlers - All Exchange Functions
package handlers

import (
	"encoding/hex"
	"errors"
	"fmt"
	"math/rand"
	"net/http"
	"net/mail"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5"
	"github.com/pquerna/otp/totp"
	"golang.org/x/crypto/bcrypt"

	"tigerex/server/middleware"
	"tigerex/server/models"
)

// ============ MARKET DATA ============

func GetMarkets(c *gin.Context) {
	rows, err := models.Pool.Query(c.Request.Context(), `
		SELECT symbol, base_currency, quote_currency, status
		FROM markets
		WHERE status IN ('active', 'trading')
		ORDER BY symbol
	`)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "error": gin.H{"code": 503, "message": "Configured market metadata is unavailable"}})
		return
	}
	defer rows.Close()

	markets := []gin.H{}
	for rows.Next() {
		var symbol, baseCurrency, quoteCurrency, status string
		if err := rows.Scan(&symbol, &baseCurrency, &quoteCurrency, &status); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Market metadata could not be read"}})
			return
		}
		markets = append(markets, gin.H{
			"symbol": symbol, "baseCurrency": baseCurrency,
			"quoteCurrency": quoteCurrency, "status": status,
		})
	}
	if err := rows.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Market metadata query failed"}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": markets})
}
func GetTicker(c *gin.Context) {
	c.JSON(http.StatusServiceUnavailable, gin.H{
		"success": false,
		"error":   gin.H{"code": 503, "message": "Live market data provider is not configured; synthetic market data is disabled"},
	})
}
func GetOrderBook(c *gin.Context) {
	c.JSON(http.StatusServiceUnavailable, gin.H{
		"success": false,
		"error":   gin.H{"code": 503, "message": "Live market data provider is not configured; synthetic market data is disabled"},
	})
}
func GetKlines(c *gin.Context) {
	c.JSON(http.StatusServiceUnavailable, gin.H{
		"success": false,
		"error":   gin.H{"code": 503, "message": "Live market data provider is not configured; synthetic market data is disabled"},
	})
}
func GetRecentTrades(c *gin.Context) {
	c.JSON(http.StatusServiceUnavailable, gin.H{
		"success": false,
		"error":   gin.H{"code": 503, "message": "Live market data provider is not configured; synthetic market data is disabled"},
	})
}
func Register(c *gin.Context) {
	var req RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"success": false, "error": gin.H{"code": 400, "message": "Invalid request body"}})
		return
	}

	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	req.Username = strings.ToLower(strings.TrimSpace(req.Username))
	req.CountryCode = strings.ToUpper(strings.TrimSpace(req.CountryCode))

	if err := validateRegistration(req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	// Check if user exists
	var count int
	err := models.Pool.QueryRow(c.Request.Context(),
		"SELECT COUNT(*) FROM users WHERE email = $1 OR username = $2",
		req.Email, req.Username).Scan(&count)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "error": gin.H{"code": 503, "message": "Registration is temporarily unavailable"}})
		return
	}
	if count > 0 {
		c.JSON(http.StatusConflict, gin.H{"success": false, "error": gin.H{"code": 409, "message": "User already exists"}})
		return
	}

	// Hash password. Never continue registration if password hashing fails.
	salt := models.GenerateSalt()
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password+salt), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Registration could not be completed"}})
		return
	}

	userID := uuid.New()
	refCode := "TIGER" + strings.ToUpper(hex.EncodeToString([]byte(userID.String()[:8]))[:6])

	ctx := c.Request.Context()
	tx, err := models.Pool.Begin(ctx)
	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Database error"}})
		return
	}
	defer tx.Rollback(ctx)

	// Create user
	_, err = tx.Exec(ctx, `
		INSERT INTO users (id, email, username, password_hash, password_salt, referral_code, status, kyc_level, jurisdiction)
		VALUES ($1, $2, $3, $4, $5, $6, 'active', 0, $7)
	`, userID, req.Email, req.Username, string(hash), salt, refCode, req.CountryCode)

	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Failed to create user"}})
		return
	}

	// Every registration write must succeed; otherwise roll back the whole transaction.
	if _, err = tx.Exec(ctx, `INSERT INTO user_profiles (id, user_id) VALUES ($1, $2)`, uuid.New(), userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Registration could not be completed"}})
		return
	}

	// Create only ledger accounts; these are not blockchain deposit addresses.
	defaultCurrencies := []string{"USDT", "BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "DOGE"}
	for _, currency := range defaultCurrencies {
		network := "MAINNET"
		if currency == "ETH" || currency == "USDT" {
			network = "ERC20"
		} else if currency == "BNB" {
			network = "BEP20"
		}
		if _, err = tx.Exec(ctx, `
			INSERT INTO wallets (id, user_id, currency, network, wallet_type, balance, locked, available)
			VALUES ($1, $2, $3, $4, 'spot', 0, 0, 0)
			ON CONFLICT (user_id, currency, network, wallet_type) DO NOTHING
		`, uuid.New(), userID, currency, network); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Registration could not be completed"}})
			return
		}
	}

	if err = tx.Commit(ctx); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Registration could not be completed"}})
		return
	}

	// Generate tokens
	accessToken, refreshToken := generateTokens(userID.String())

	c.JSON(201, gin.H{
		"success": true,
		"data": gin.H{
			"accessToken":  accessToken,
			"refreshToken": refreshToken,
			"expiresIn":    3600,
			"tokenType":    "Bearer",
			"user": gin.H{
				"id":               userID,
				"email":            req.Email,
				"username":         req.Username,
				"kycLevel":         0,
				"twoFactorEnabled": false,
			},
		},
	})
}

type RegisterRequest struct {
	Email       string `json:"email" binding:"required"`
	Username    string `json:"username" binding:"required"`
	Password    string `json:"password" binding:"required"`
	CountryCode string `json:"countryCode"`
}

const (
	// Bounds are chosen so that stored values always fit the VARCHAR widths in
	// the canonical schema (email 255, username 100, jurisdiction 3).
	minPasswordLength = 12
	maxPasswordLength = 128
	maxEmailLength    = 255
	maxUsernameLength = 100
	minUsernameLength = 3
)

// validateRegistration rejects malformed or abusive registration input before
// it reaches the database. Every rejection returns a generic message so the
// endpoint does not leak which constraint failed.
func validateRegistration(req RegisterRequest) error {
	if req.Email == "" || utf8.RuneCountInString(req.Email) > maxEmailLength {
		return errors.New("Invalid email address")
	}
	addr, err := mail.ParseAddress(req.Email)
	if err != nil || addr.Address != req.Email {
		return errors.New("Invalid email address")
	}

	if len(req.Username) < minUsernameLength || utf8.RuneCountInString(req.Username) > maxUsernameLength {
		return fmt.Errorf("Username must be between %d and %d characters", minUsernameLength, maxUsernameLength)
	}
	for _, r := range req.Username {
		if !(r >= 'a' && r <= 'z') && !(r >= '0' && r <= '9') && r != '_' && r != '-' && r != '.' {
			return errors.New("Username may only contain letters, numbers, dot, dash and underscore")
		}
	}

	// Reject control characters outright rather than trimming them away.
	for _, r := range req.Password {
		if r < 0x20 || r == 0x7f {
			return errors.New("Password may not contain control characters")
		}
	}
	if len(req.Password) < minPasswordLength || len(req.Password) > maxPasswordLength {
		return fmt.Errorf("Password must be between %d and %d characters", minPasswordLength, maxPasswordLength)
	}

	if req.CountryCode != "" {
		if len(req.CountryCode) != 2 {
			return errors.New("Country code must be a 2-letter ISO 3166-1 alpha-2 code")
		}
		for _, r := range req.CountryCode {
			if r < 'A' || r > 'Z' {
				return errors.New("Country code must be a 2-letter ISO 3166-1 alpha-2 code")
			}
		}
	}
	return nil
}

type LoginRequest struct {
	Email    string `json:"email" binding:"required"`
	Password string `json:"password" binding:"required"`
}

func Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	// Find user
	var user struct {
		ID              string
		PasswordHash    string
		PasswordSalt    string
		KycLevel        int
		Status          string
		TwoFactorEnable bool
	}
	err := models.Pool.QueryRow(c.Request.Context(), `
		SELECT id, password_hash, password_salt, kyc_level, status, two_factor_enabled 
		FROM users WHERE email = $1
	`, strings.ToLower(req.Email)).Scan(&user.ID, &user.PasswordHash, &user.PasswordSalt, &user.KycLevel, &user.Status, &user.TwoFactorEnable)

	if err != nil || user.ID == "" {
		c.JSON(401, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Invalid credentials"}})
		return
	}

	if user.Status != "active" {
		c.JSON(403, gin.H{"success": false, "error": gin.H{"code": 403, "message": "Account not active"}})
		return
	}

	// Verify password
	valid := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password+user.PasswordSalt))
	if valid != nil {
		c.JSON(401, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Invalid credentials"}})
		return
	}

	// Check if needs 2FA
	if user.TwoFactorEnable {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"requiresTwoFactor": true, "userId": user.ID}})
		return
	}

	// Generate tokens
	accessToken, refreshToken := generateTokens(user.ID)

	// Update last login
	ctx := c.Request.Context()
	_, _ = models.Pool.Exec(ctx, "UPDATE users SET last_login_at = NOW() WHERE id = $1", user.ID)

	// Save session
	_, _ = models.Pool.Exec(ctx, `
		INSERT INTO sessions (id, user_id, session_token, refresh_token, ip_address, user_agent, expires_at, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
	`, uuid.New(), user.ID, accessToken, refreshToken, c.ClientIP(), c.Request.UserAgent(), time.Now().Add(7*24*time.Hour))

	c.JSON(200, gin.H{
		"success": true,
		"data": gin.H{
			"accessToken":  accessToken,
			"refreshToken": refreshToken,
			"expiresIn":    3600,
			"tokenType":    "Bearer",
			"user": gin.H{
				"id":               user.ID,
				"email":            req.Email,
				"kycLevel":         user.KycLevel,
				"status":           user.Status,
				"twoFactorEnabled": user.TwoFactorEnable,
			},
		},
	})
}

func generateTokens(userID string) (string, string) {
	accessToken := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": userID,
		"type":    "access",
		"exp":     time.Now().Add(time.Hour).Unix(),
	})
	accessStr, _ := accessToken.SignedString(middleware.JWTSecret)

	refreshToken := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": userID,
		"type":    "refresh",
		"exp":     time.Now().Add(7 * 24 * time.Hour).Unix(),
	})
	refreshStr, _ := refreshToken.SignedString(middleware.JWTSecret)

	return accessStr, refreshStr
}

func RefreshToken(c *gin.Context) {
	var req struct {
		RefreshToken string `json:"refreshToken" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"success": false, "error": gin.H{"code": 400, "message": "Token required"}})
		return
	}

	token, err := jwt.Parse(req.RefreshToken, func(t *jwt.Token) (interface{}, error) {
		if t.Method != jwt.SigningMethodHS256 {
			return nil, fmt.Errorf("unexpected JWT signing method: %s", t.Method.Alg())
		}
		if len(middleware.JWTSecret) < 32 {
			return nil, fmt.Errorf("JWT signing key is not configured")
		}
		return middleware.JWTSecret, nil
	})

	if err != nil || !token.Valid {
		c.JSON(401, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Invalid token"}})
		return
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		c.JSON(401, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Invalid token"}})
		return
	}
	if t, _ := claims["type"].(string); t != "refresh" {
		c.JSON(401, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Invalid token type"}})
		return
	}
	userID, ok := claims["user_id"].(string)
	if !ok || userID == "" {
		c.JSON(401, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Invalid token"}})
		return
	}

	accessToken, refreshToken := generateTokens(userID)

	// Rotate the stored session so the previous token pair is no longer usable.
	if _, err := models.Pool.Exec(c.Request.Context(), `
		UPDATE sessions SET session_token = $1, refresh_token = $2, expires_at = $3
		WHERE user_id = $4 AND refresh_token = $5
	`, accessToken, refreshToken, time.Now().Add(7*24*time.Hour), userID, req.RefreshToken); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "error": gin.H{"code": 503, "message": "Could not rotate session"}})
		return
	}

	c.JSON(200, gin.H{"success": true, "data": gin.H{"accessToken": accessToken, "refreshToken": refreshToken}})
}

func Logout(c *gin.Context) {
	token := c.GetHeader("Authorization")
	token = strings.TrimPrefix(token, "Bearer ")
	if token != "" {
		_, _ = models.Pool.Exec(c.Request.Context(), "UPDATE sessions SET status = 'expired' WHERE session_token = $1", token)
	}
	c.JSON(200, gin.H{"success": true, "data": gin.H{"message": "Logged out"}})
}

// Social / Web3 / Biometric login stubs
func MetaMaskLogin(c *gin.Context) {
	c.JSON(501, gin.H{"success": false, "error": gin.H{"code": 501, "message": "MetaMask login not implemented"}})
}

func SocialLogin(c *gin.Context) {
	c.JSON(501, gin.H{"success": false, "error": gin.H{"code": 501, "message": "Social login not implemented"}})
}

func BiometricLogin(c *gin.Context) {
	c.JSON(501, gin.H{"success": false, "error": gin.H{"code": 501, "message": "Biometric login not implemented"}})
}

// ============ 2FA ============

func Setup2FA(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(401, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}

	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      "TigerEx",
		AccountName: userID,
	})
	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Failed to generate 2FA secret"}})
		return
	}

	secret := key.Secret()
	_, _ = models.Pool.Exec(c.Request.Context(), "UPDATE users SET two_factor_secret = $1 WHERE id = $2", secret, userID)

	c.JSON(200, gin.H{"success": true, "data": gin.H{"secret": secret, "qrCode": key.URL()}})
}

func Enable2FA(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(401, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}

	var req struct {
		Code string `json:"code" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"success": false, "error": gin.H{"code": 400, "message": "Code required"}})
		return
	}

	var secret string
	err := models.Pool.QueryRow(c.Request.Context(), "SELECT two_factor_secret FROM users WHERE id = $1", userID).Scan(&secret)
	if err != nil || secret == "" {
		c.JSON(400, gin.H{"success": false, "error": gin.H{"code": 400, "message": "2FA not initialized"}})
		return
	}

	if !totp.Validate(req.Code, secret) {
		c.JSON(400, gin.H{"success": false, "error": gin.H{"code": 400, "message": "Invalid code"}})
		return
	}

	_, _ = models.Pool.Exec(c.Request.Context(), "UPDATE users SET two_factor_enabled = true WHERE id = $1", userID)
	c.JSON(200, gin.H{"success": true, "data": gin.H{"message": "2FA enabled"}})
}

func Verify2FA(c *gin.Context) {
	var req struct {
		UserID string `json:"userId" binding:"required"`
		Code   string `json:"code" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"success": false, "error": gin.H{"code": 400, "message": "Required fields missing"}})
		return
	}

	var secret string
	err := models.Pool.QueryRow(c.Request.Context(), "SELECT two_factor_secret FROM users WHERE id = $1", req.UserID).Scan(&secret)
	if err != nil || secret == "" {
		c.JSON(400, gin.H{"success": false, "error": gin.H{"code": 400, "message": "2FA not configured"}})
		return
	}

	if !totp.Validate(req.Code, secret) {
		c.JSON(401, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Invalid 2FA code"}})
		return
	}

	accessToken, refreshToken := generateTokens(req.UserID)
	c.JSON(200, gin.H{"success": true, "data": gin.H{"accessToken": accessToken, "refreshToken": refreshToken}})
}

// ============ WALLET ============

func GetBalances(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(401, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}

	rows, err := models.Pool.Query(c.Request.Context(), `
		SELECT w.currency, w.network, w.wallet_type, w.balance, w.locked, w.available
		FROM wallets w WHERE w.user_id = $1 ORDER BY w.currency
	`, userID)

	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Database error"}})
		return
	}
	defer rows.Close()

	balances := []gin.H{}
	for rows.Next() {
		var balance, locked, available float64
		var currency, network, walletType string
		rows.Scan(&currency, &network, &walletType, &balance, &locked, &available)
		balances = append(balances, gin.H{
			"currency":  currency,
			"network":   network,
			"type":      walletType,
			"balance":   balance,
			"locked":    locked,
			"available": available,
		})
	}

	c.JSON(200, gin.H{"success": true, "data": balances})
}

func GetTotalAssets(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}
	// Portfolio valuation must use a configured, timestamped market-data source.
	// Hard-coded prices are intentionally not presented as live account values.
	c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "error": gin.H{"code": 503, "message": "Portfolio price oracle is not configured; valuation is unavailable"}})
}

func GetDepositAddress(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}
	// Do not invent deposit addresses. Address derivation must be provided by a
	// chain-specific wallet/key-management service before this endpoint is enabled.
	c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "error": gin.H{"code": 503, "message": "Deposit address service is not configured; no address was generated"}})
}

func GenerateDepositAddress(c *gin.Context) {
	if middleware.GetUserID(c) == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}
	// Fail closed until chain-specific address derivation, custody controls, and
	// address persistence are backed by the production wallet service.
	c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "error": gin.H{"code": 503, "message": "Deposit address service is not configured; no address was generated"}})
}

func GetAddresses(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}
	currency := strings.TrimSpace(c.Query("currency"))
	query := "SELECT currency, network, address, is_default FROM wallet_addresses WHERE user_id = $1"
	args := []interface{}{userID}
	if currency != "" {
		query += " AND currency = $2"
		args = append(args, currency)
	}
	query += " ORDER BY is_default DESC"
	rows, err := models.Pool.Query(c.Request.Context(), query, args...)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "error": gin.H{"code": 503, "message": "Wallet address records are unavailable"}})
		return
	}
	defer rows.Close()
	addresses := []gin.H{}
	for rows.Next() {
		var currency, network, address string
		var isDefault bool
		if err := rows.Scan(&currency, &network, &address, &isDefault); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Wallet address records could not be read"}})
			return
		}
		addresses = append(addresses, gin.H{"currency": currency, "network": network, "address": address, "isDefault": isDefault})
	}
	if err := rows.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Wallet address query failed"}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": addresses})
}

type WithdrawRequest struct {
	Currency  string  `json:"currency" binding:"required"`
	Amount    float64 `json:"amount" binding:"required,gt=0"`
	ToAddress string  `json:"toAddress" binding:"required"`
	Network   string  `json:"network"`
	Memo      string  `json:"memo"`
}

func Withdraw(c *gin.Context) {
	if middleware.GetUserID(c) == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}
	// Withdrawals require a durable ledger, KYC/risk policy, destination validation,
	// approval controls, and a signed chain transaction. Do not debit or claim success
	// until those components are integrated and tested.
	c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "error": gin.H{"code": 503, "message": "Withdrawal execution is not configured; no funds were debited"}})
}

type TransferRequest struct {
	ToUsername string  `json:"toUsername" binding:"required"`
	Currency   string  `json:"currency" binding:"required"`
	Amount     float64 `json:"amount" binding:"required,gt=0"`
}

func Transfer(c *gin.Context) {
	if middleware.GetUserID(c) == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}
	// Transfers must be implemented as one atomic ledger transaction with row locks,
	// idempotency, decimal-safe amounts, and audit entries. Fail closed until then.
	c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "error": gin.H{"code": 503, "message": "Internal transfer ledger is not configured; no funds were moved"}})
}

func Deposit(c *gin.Context) {
	if middleware.GetUserID(c) == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}
	// Client-supplied amount/currency/transaction hash are not proof of an on-chain
	// deposit. Never credit funds before a chain adapter verifies asset contract,
	// destination, amount, confirmations/finality, and replay/idempotency.
	c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "error": gin.H{"code": 503, "message": "Deposit verification is not configured; no funds were credited"}})
}

func GetTransactionHistory(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(401, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}

	limit := 50
	if l := c.Query("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil {
			limit = parsed
		}
	}

	rows, err := models.Pool.Query(c.Request.Context(), `
		SELECT id, type, currency, amount, fee, status, tx_hash, from_address, to_address, created_at, completed_at
		FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2
	`, userID, limit)

	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Database error"}})
		return
	}
	defer rows.Close()

	transactions := []gin.H{}
	for rows.Next() {
		var id, txType, currency, status, from, to string
		var amount, fee float64
		var createdAt, completedAt time.Time
		rows.Scan(&id, &txType, &currency, &amount, &fee, &status, &from, &to, &createdAt, &completedAt)
		transactions = append(transactions, gin.H{
			"id":          id,
			"type":        txType,
			"currency":    currency,
			"amount":      amount,
			"fee":         fee,
			"status":      status,
			"txHash":      from,
			"from":        from,
			"to":          to,
			"createdAt":   createdAt,
			"completedAt": completedAt,
		})
	}

	c.JSON(200, gin.H{"success": true, "data": gin.H{"transactions": transactions}})
}

func GetNetworkFees(c *gin.Context) {
	rows, err := models.Pool.Query(c.Request.Context(), `
		SELECT COALESCE(blockchain_id, ''), token_symbol, fee_amount, fee_percentage, min_fee, max_fee
		FROM fee_configs
		WHERE fee_type = 'withdraw' AND status = 'active'
		ORDER BY token_symbol
	`)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "error": gin.H{"code": 503, "message": "Network fees are unavailable"}})
		return
	}
	defer rows.Close()

	fees := gin.H{}
	for rows.Next() {
		var blockchainID, symbol string
		var feeAmount, feePercentage, minFee, maxFee float64
		if err := rows.Scan(&blockchainID, &symbol, &feeAmount, &feePercentage, &minFee, &maxFee); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Network fees could not be read"}})
			return
		}
		fees[symbol] = gin.H{
			"network":      blockchainID,
			"withdraw":     feeAmount,
			"withdrawRate": feePercentage,
			"minFee":       minFee,
			"maxFee":       maxFee,
		}
	}
	if err := rows.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Network fees could not be read"}})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": fees})
}

// ============ SPOT TRADING ============

type OrderRequest struct {
	Symbol      string  `json:"symbol" binding:"required"`
	Side        string  `json:"side" binding:"required,oneof=buy sell"`
	OrderType   string  `json:"orderType" binding:"required,oneof=market limit stop_market stop_limit"`
	Quantity    float64 `json:"quantity" binding:"required,gt=0"`
	Price       float64 `json:"price"`
	StopPrice   float64 `json:"stopPrice"`
	TimeInForce string  `json:"timeInForce"`
}

func PlaceSpotOrder(c *gin.Context) {
	// The legacy implementation debited/credited user balances using hard-coded
	// prices and marked market orders filled without a matching-engine execution.
	// Reject all orders until the durable matching engine and ledger are connected.
	c.JSON(http.StatusServiceUnavailable, gin.H{
		"success": false,
		"error":   gin.H{"code": 503, "message": "Spot order execution is unavailable until the durable matching engine and ledger are configured"},
	})
}
func CancelOrder(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(401, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}

	orderID := c.Param("orderId")

	// Get order
	var order struct {
		Status string
		Side   string
		Symbol string
		Price  float64
		Qty    float64
	}
	err := models.Pool.QueryRow(c.Request.Context(), `
		SELECT status, side, market_symbol, price, quantity FROM spot_orders 
		WHERE id = $1 AND user_id = $2
	`, orderID, userID).Scan(&order.Status, &order.Side, &order.Symbol, &order.Price, &order.Qty)

	if err != nil || order.Status == "" {
		c.JSON(404, gin.H{"success": false, "error": gin.H{"code": 404, "message": "Order not found"}})
		return
	}

	if order.Status == "filled" || order.Status == "canceled" {
		c.JSON(400, gin.H{"success": false, "error": gin.H{"code": 400, "message": "Order cannot be canceled"}})
		return
	}

	// Unlock funds
	currency := order.Symbol
	var curr string
	if order.Side == "buy" {
		curr = strings.Split(currency, "-")[1]
	} else {
		curr = strings.Split(currency, "-")[0]
	}

	requiredAmount := order.Qty * order.Price
	_, _ = models.Pool.Exec(c.Request.Context(), `
		UPDATE wallets SET available = available + $1, locked = locked - $1, updated_at = NOW()
		WHERE user_id = $2 AND currency = $3 AND wallet_type = 'spot'
	`, requiredAmount, userID, curr)

	// Cancel order
	_, _ = models.Pool.Exec(c.Request.Context(), "UPDATE spot_orders SET status = 'canceled', updated_at = NOW() WHERE id = $1", orderID)

	c.JSON(200, gin.H{"success": true, "data": gin.H{"message": "Order canceled"}})
}

func GetOpenOrders(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(401, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}

	symbol := c.Query("symbol")
	query := "SELECT id, market_symbol, side, order_type, quantity, price, filled_quantity, status FROM spot_orders WHERE user_id = $1 AND status IN ('new', 'partially_filled')"
	args := []interface{}{userID}
	if symbol != "" {
		query += " AND market_symbol = $2"
		args = append(args, symbol)
	}
	query += " ORDER BY created_at DESC LIMIT 100"

	rows, err := models.Pool.Query(c.Request.Context(), query, args...)
	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Database error"}})
		return
	}
	defer rows.Close()

	orders := []gin.H{}
	for rows.Next() {
		var id, market, side, orderType, status string
		var quant, price, filledQty float64
		rows.Scan(&id, &market, &side, &orderType, &quant, &price, &filledQty, &status)
		orders = append(orders, gin.H{
			"orderId":        id,
			"symbol":         market,
			"side":           side,
			"orderType":      orderType,
			"quantity":       quant,
			"price":          price,
			"filledQuantity": filledQty,
			"status":         status,
		})
	}

	c.JSON(200, gin.H{"success": true, "data": orders})
}

func GetOrderHistory(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(401, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}

	limit := 50
	if l := c.Query("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil {
			limit = parsed
		}
	}

	rows, err := models.Pool.Query(c.Request.Context(), `
		SELECT id, market_symbol, side, order_type, quantity, price, filled_quantity, average_price, commission, status, created_at, completed_at
		FROM spot_orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2
	`, userID, limit)

	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Database error"}})
		return
	}
	defer rows.Close()

	orders := []gin.H{}
	for rows.Next() {
		var id, market, side, orderType, status string
		var quant, price, avgPrice, comm float64
		var createdAt, completedAt time.Time
		rows.Scan(&id, &market, &side, &orderType, &quant, &price, &quant, &avgPrice, &comm, &status, &createdAt, &completedAt)
		orders = append(orders, gin.H{
			"orderId":        id,
			"symbol":         market,
			"side":           side,
			"orderType":      orderType,
			"quantity":       quant,
			"price":          price,
			"filledQuantity": quant,
			"averagePrice":   avgPrice,
			"commission":     comm,
			"status":         status,
			"createdAt":      createdAt,
		})
	}

	c.JSON(200, gin.H{"success": true, "data": orders})
}

func GetMyTrades(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}

	rows, err := models.Pool.Query(c.Request.Context(), `
		SELECT id, market_symbol, side, order_type, quantity, price, filled_quantity,
		       average_price, commission, status, created_at
		FROM spot_orders
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT 100
	`, userID)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "error": gin.H{"code": 503, "message": "Trade history is temporarily unavailable"}})
		return
	}
	defer rows.Close()

	trades := []gin.H{}
	for rows.Next() {
		var id, symbol, side, orderType, status string
		var quantity, filled, commission float64
		var price, averagePrice *float64
		var createdAt time.Time
		if err := rows.Scan(&id, &symbol, &side, &orderType, &quantity, &price, &filled, &averagePrice, &commission, &status, &createdAt); err != nil {
			continue
		}
		trades = append(trades, gin.H{
			"id":             id,
			"symbol":         symbol,
			"side":           side,
			"orderType":      orderType,
			"quantity":       quantity,
			"price":          price,
			"filledQuantity": filled,
			"averagePrice":   averagePrice,
			"commission":     commission,
			"status":         status,
			"createdAt":      createdAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": trades})
}

func QuoteOrder(c *gin.Context) {
	// Quotes must come from the same live market data and risk services that
	// validate orders. Never calculate a quote from a hard-coded reference price.
	c.JSON(http.StatusServiceUnavailable, gin.H{
		"success": false,
		"error":   gin.H{"code": 503, "message": "Order quoting is unavailable until live market data and risk checks are configured"},
	})
}
func GetProfile(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(401, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}

	var id uuid.UUID
	var email, username string
	var kycLevel int
	var status string
	var twoFactorEnabled, emailVerified, phoneVerified bool
	var riskCategory string
	var createdAt *time.Time
	var firstName, lastName, avatarUrl, languagePreference, timezone string

	err := models.Pool.QueryRow(c.Request.Context(), `
		SELECT u.id, u.email, u.username, u.kyc_level, u.status, u.two_factor_enabled, 
			   u.email_verified, u.phone_verified, u.risk_category, u.created_at,
			   p.first_name, p.last_name, p.avatar_url, p.language_preference, p.timezone
		FROM users u
		LEFT JOIN user_profiles p ON u.id = p.user_id
		WHERE u.id = $1
	`, userID).Scan(&id, &email, &username, &kycLevel, &status, &twoFactorEnabled, &emailVerified, &phoneVerified, &riskCategory, &createdAt, &firstName, &lastName, &avatarUrl, &languagePreference, &timezone)

	if err != nil {
		c.JSON(404, gin.H{"success": false, "error": gin.H{"code": 404, "message": "User not found"}})
		return
	}

	profile := gin.H{
		"id":                 id,
		"email":              email,
		"username":           username,
		"kycLevel":           kycLevel,
		"status":             status,
		"twoFactorEnabled":   twoFactorEnabled,
		"emailVerified":      emailVerified,
		"phoneVerified":      phoneVerified,
		"riskCategory":       riskCategory,
		"createdAt":          createdAt,
		"firstName":          firstName,
		"lastName":           lastName,
		"avatarUrl":          avatarUrl,
		"languagePreference": languagePreference,
		"timezone":           timezone,
	}

	c.JSON(200, gin.H{"success": true, "data": profile})
}

func UpdateProfile(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(401, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}

	var req struct {
		FirstName          string `json:"firstName"`
		LastName           string `json:"lastName"`
		AvatarUrl          string `json:"avatarUrl"`
		LanguagePreference string `json:"languagePreference"`
		Timezone           string `json:"timezone"`
	}
	c.ShouldBindJSON(&req)

	_, _ = models.Pool.Exec(c.Request.Context(), `
		UPDATE user_profiles SET 
			first_name = COALESCE(NULLIF($1, ''), first_name),
			last_name = COALESCE(NULLIF($2, ''), last_name),
			avatar_url = COALESCE(NULLIF($3, ''), avatar_url),
			language_preference = COALESCE(NULLIF($4, ''), language_preference),
			timezone = COALESCE(NULLIF($5, ''), timezone),
			updated_at = NOW()
		WHERE user_id = $6
	`, req.FirstName, req.LastName, req.AvatarUrl, req.LanguagePreference, req.Timezone, userID)

	c.JSON(200, gin.H{"success": true, "data": gin.H{"message": "Profile updated"}})
}

type SubmitKYCRequest struct {
	DocumentType   string `json:"documentType" binding:"required"`
	DocumentNumber string `json:"documentNumber" binding:"required"`
	FrontUrl       string `json:"frontUrl"`
	BackUrl        string `json:"backUrl"`
	SelfieUrl      string `json:"selfieUrl"`
}

func SubmitKYC(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(401, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}

	var req SubmitKYCRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	// Check for existing pending KYC
	var existing string
	err := models.Pool.QueryRow(c.Request.Context(), `
		SELECT id FROM kyc_documents WHERE user_id = $1 AND status IN ('pending', 'reviewing')
	`, userID).Scan(&existing)

	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "KYC submission could not be checked"}})
		return
	}

	if existing != "" {
		c.JSON(400, gin.H{"success": false, "error": gin.H{"code": 400, "message": "KYC already submitted"}})
		return
	}

	// Store the submission as pending. A KYC level is only granted by an
	// operator decision; submitting documents never raises it.
	kycID := uuid.New()
	if _, err := models.Pool.Exec(c.Request.Context(), `
		INSERT INTO kyc_documents (id, user_id, document_type, document_number, front_url, back_url, selfie_url, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`, kycID, userID, req.DocumentType, req.DocumentNumber, req.FrontUrl, req.BackUrl, req.SelfieUrl, "pending"); err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "KYC submission could not be stored"}})
		return
	}

	c.JSON(200, gin.H{"success": true, "data": gin.H{"status": "pending", "message": "KYC submitted for review"}})
}

func GetKYCStatus(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(401, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}

	var kycLevel int
	var doc gin.H
	err := models.Pool.QueryRow(c.Request.Context(), "SELECT kyc_level FROM users WHERE id = $1", userID).Scan(&kycLevel)

	if err == nil {
		doc = gin.H{"level": kycLevel}
	}

	c.JSON(200, gin.H{"success": true, "data": gin.H{"kycLevel": kycLevel, "document": doc}})
}

func ChangePassword(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(401, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}

	var req struct {
		CurrentPassword string `json:"currentPassword" binding:"required"`
		NewPassword     string `json:"newPassword" binding:"required,min=8"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	// Verify current password
	var hash, salt string
	err := models.Pool.QueryRow(c.Request.Context(), "SELECT password_hash, password_salt FROM users WHERE id = $1", userID).Scan(&hash, &salt)

	if err != nil || bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.CurrentPassword+salt)) != nil {
		c.JSON(400, gin.H{"success": false, "error": gin.H{"code": 400, "message": "Current password incorrect"}})
		return
	}

	// Update password
	newSalt := models.GenerateSalt()
	newHash, _ := bcrypt.GenerateFromPassword([]byte(req.NewPassword+newSalt), bcrypt.DefaultCost)

	_, _ = models.Pool.Exec(c.Request.Context(), "UPDATE users SET password_hash = $1, password_salt = $2, updated_at = NOW() WHERE id = $3", string(newHash), newSalt, userID)

	c.JSON(200, gin.H{"success": true, "data": gin.H{"message": "Password changed"}})
}

// ============ FUTURES ============

func GetFuturesContracts(c *gin.Context) {
	rows, err := models.Pool.Query(c.Request.Context(), `
		SELECT symbol, base_currency, quote_currency, contract_type, status
		FROM futures_markets
		WHERE status = 'active'
		ORDER BY symbol
	`)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "error": gin.H{"code": 503, "message": "Configured futures contracts are unavailable"}})
		return
	}
	defer rows.Close()

	contracts := []gin.H{}
	for rows.Next() {
		var symbol, baseCurrency, quoteCurrency, contractType, status string
		if err := rows.Scan(&symbol, &baseCurrency, &quoteCurrency, &contractType, &status); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Futures contract metadata could not be read"}})
			return
		}
		contracts = append(contracts, gin.H{
			"symbol": symbol, "baseCurrency": baseCurrency, "quoteCurrency": quoteCurrency,
			"type": contractType, "status": status,
		})
	}
	if err := rows.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Futures contract query failed"}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": contracts})
}
func OpenFuturesPosition(c *gin.Context) {
	c.JSON(http.StatusServiceUnavailable, gin.H{
		"success": false,
		"error":   gin.H{"code": 503, "message": "Futures execution is unavailable until the durable matching and risk engine is configured"},
	})
}
func CloseFuturesPosition(c *gin.Context) {
	c.JSON(http.StatusServiceUnavailable, gin.H{
		"success": false,
		"error":   gin.H{"code": 503, "message": "Futures execution is unavailable until the durable matching and risk engine is configured"},
	})
}
func GetFuturesPositions(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}

	rows, err := models.Pool.Query(c.Request.Context(), `
		SELECT id, contract_symbol, side, size, entry_price, mark_price, margin, leverage,
		       liq_price, unrealized_pnl, created_at
		FROM futures_positions
		WHERE user_id = $1
		ORDER BY created_at DESC
	`, userID)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "error": gin.H{"code": 503, "message": "Positions are temporarily unavailable"}})
		return
	}
	defer rows.Close()

	positions := []gin.H{}
	for rows.Next() {
		var id, symbol, side string
		var size, entryPrice, margin float64
		var markPrice, liqPrice, unrealizedPnl *float64
		var leverage int
		var createdAt time.Time
		if err := rows.Scan(&id, &symbol, &side, &size, &entryPrice, &markPrice, &margin, &leverage, &liqPrice, &unrealizedPnl, &createdAt); err != nil {
			continue
		}
		positions = append(positions, gin.H{
			"id":               id,
			"symbol":           symbol,
			"side":             side,
			"size":             size,
			"entryPrice":       entryPrice,
			"markPrice":        markPrice,
			"margin":           margin,
			"leverage":         leverage,
			"liquidationPrice": liqPrice,
			"unrealizedPnl":    unrealizedPnl,
			"createdAt":        createdAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": positions})
}

func QuoteFutures(c *gin.Context) {
	c.JSON(http.StatusServiceUnavailable, gin.H{
		"success": false,
		"error":   gin.H{"code": 503, "message": "Futures execution is unavailable until the durable matching and risk engine is configured"},
	})
}
func GetMarginAccount(c *gin.Context) {
	c.JSON(http.StatusServiceUnavailable, gin.H{
		"success": false,
		"error":   gin.H{"code": 503, "message": "Margin accounts are unavailable until the margin ledger is configured"},
	})
}

func BorrowMargin(c *gin.Context) {
	c.JSON(http.StatusServiceUnavailable, gin.H{
		"success": false,
		"error":   gin.H{"code": 503, "message": "Margin borrowing is unavailable until the risk and ledger services are configured"},
	})
}

func RepayMargin(c *gin.Context) {
	c.JSON(http.StatusServiceUnavailable, gin.H{
		"success": false,
		"error":   gin.H{"code": 503, "message": "Margin repayment is unavailable until the risk and ledger services are configured"},
	})
}

func GetMarginPositions(c *gin.Context) {
	c.JSON(http.StatusServiceUnavailable, gin.H{
		"success": false,
		"error":   gin.H{"code": 503, "message": "Margin positions are unavailable until the risk engine is configured"},
	})
}

// ============ OPTIONS ============

func GetOptionsContracts(c *gin.Context) {
	rows, err := models.Pool.Query(c.Request.Context(), `
		SELECT symbol, underlying, strike_price, expiry_date, option_type, contract_size, status
		FROM options WHERE status = 'active' ORDER BY expiry_date, symbol
	`)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "error": gin.H{"code": 503, "message": "Configured option contracts are unavailable"}})
		return
	}
	defer rows.Close()

	contracts := []gin.H{}
	for rows.Next() {
		var symbol, underlying, optionType, status string
		var strike, contractSize float64
		var expiry interface{}
		if err := rows.Scan(&symbol, &underlying, &strike, &expiry, &optionType, &contractSize, &status); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Option contract metadata could not be read"}})
			return
		}
		contracts = append(contracts, gin.H{
			"symbol": symbol, "underlying": underlying, "strike": strike, "expiry": expiry,
			"type": optionType, "contractSize": contractSize, "status": status,
		})
	}
	if err := rows.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Option contract query failed"}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": contracts})
}

func TradeOptions(c *gin.Context) {
	c.JSON(http.StatusServiceUnavailable, gin.H{
		"success": false,
		"error":   gin.H{"code": 503, "message": "Options execution is unavailable until the pricing and matching engine is configured"},
	})
}

func GetOptionsPositions(c *gin.Context) {
	c.JSON(http.StatusServiceUnavailable, gin.H{
		"success": false,
		"error":   gin.H{"code": 503, "message": "Options positions are unavailable until the pricing engine is configured"},
	})
}

// ============ P2P ============

func GetP2PAds(c *gin.Context) {
	rows, err := models.Pool.Query(c.Request.Context(), `
		SELECT id, user_id, type, fiat_currency, crypto_currency, amount, price, payment_methods, status 
		FROM p2p_ads WHERE status = 'active' ORDER BY created_at DESC LIMIT 50
	`)

	if err != nil {
		c.JSON(200, gin.H{"success": true, "data": []gin.H{}})
		return
	}
	defer rows.Close()

	ads := []gin.H{}
	for rows.Next() {
		var id, userID, adType, fiat, crypto, status string
		var amount, price float64
		var paymentMethods []string
		rows.Scan(&id, &userID, &adType, &fiat, &crypto, &amount, &price, &paymentMethods, &status)
		ads = append(ads, gin.H{
			"id":             id,
			"type":           adType,
			"fiatCurrency":   fiat,
			"cryptoCurrency": crypto,
			"amount":         amount,
			"price":          price,
			"paymentMethods": paymentMethods,
			"userId":         userID,
		})
	}

	c.JSON(200, gin.H{"success": true, "data": ads})
}

func CreateP2PAd(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(401, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}

	var req struct {
		Type           string   `json:"type" binding:"required,oneof=buy sell"`
		FiatCurrency   string   `json:"fiatCurrency" binding:"required"`
		CryptoCurrency string   `json:"cryptoCurrency" binding:"required"`
		Amount         float64  `json:"amount" binding:"required,gt=0"`
		Price          float64  `json:"price" binding:"required,gt=0"`
		PriceType      string   `json:"priceType"`
		PaymentMethods []string `json:"paymentMethods"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	adID := uuid.New()
	priceType := req.PriceType
	if priceType == "" {
		priceType = "fixed"
	}

	_, _ = models.Pool.Exec(c.Request.Context(), `
		INSERT INTO p2p_ads (id, user_id, type, fiat_currency, crypto_currency, amount, price, price_type, payment_methods, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')
	`, adID, userID, req.Type, req.FiatCurrency, req.CryptoCurrency, req.Amount, req.Price, priceType, req.PaymentMethods)

	c.JSON(200, gin.H{"success": true, "data": gin.H{"id": adID, "message": "Ad created"}})
}

func UpdateP2PAd(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}

	adID := c.Param("id")
	if _, err := uuid.Parse(adID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": gin.H{"code": 404, "message": "Ad not found"}})
		return
	}

	var req struct {
		Amount         *float64 `json:"amount"`
		Price          *float64 `json:"price"`
		PaymentMethods []string `json:"paymentMethods"`
		Status         *string  `json:"status"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": "Invalid request body"}})
		return
	}

	updates := []string{"updated_at = NOW()"}
	args := []interface{}{}
	argNum := 1

	if req.Amount != nil {
		if *req.Amount <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": "Amount must be positive"}})
			return
		}
		updates = append(updates, fmt.Sprintf("amount = $%d", argNum))
		args = append(args, *req.Amount)
		argNum++
	}
	if req.Price != nil {
		if *req.Price <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": "Price must be positive"}})
			return
		}
		updates = append(updates, fmt.Sprintf("price = $%d", argNum))
		args = append(args, *req.Price)
		argNum++
	}
	if req.PaymentMethods != nil {
		updates = append(updates, fmt.Sprintf("payment_methods = $%d", argNum))
		args = append(args, req.PaymentMethods)
		argNum++
	}
	if req.Status != nil {
		updates = append(updates, fmt.Sprintf("status = $%d", argNum))
		args = append(args, *req.Status)
		argNum++
	}

	query := "UPDATE p2p_ads SET " + strings.Join(updates, ", ") +
		fmt.Sprintf(" WHERE id = $%d AND user_id = $%d", argNum, argNum+1)
	args = append(args, adID, userID)

	tag, err := models.Pool.Exec(c.Request.Context(), query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Ad could not be updated"}})
		return
	}
	if tag.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": gin.H{"code": 404, "message": "Ad not found"}})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"message": "Ad updated"}})
}

func DeleteP2PAd(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}

	adID := c.Param("id")
	if _, err := uuid.Parse(adID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": gin.H{"code": 404, "message": "Ad not found"}})
		return
	}

	// Only the owner can delete their own ad, and only when no live trade
	// references it, so a delete cannot strand a buyer mid-trade.
	tag, err := models.Pool.Exec(c.Request.Context(), `
		DELETE FROM p2p_ads
		WHERE id = $1 AND user_id = $2
		  AND NOT EXISTS (
			SELECT 1 FROM p2p_trades t
			WHERE t.p2p_ad_id = $1 AND t.status IN ('pending', 'disputed')
		  )
	`, adID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Ad could not be deleted"}})
		return
	}
	if tag.RowsAffected() == 0 {
		c.JSON(http.StatusConflict, gin.H{"success": false, "error": gin.H{"code": 409, "message": "Ad not found, or it has an open trade and cannot be deleted"}})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"message": "Ad deleted"}})
}

func CreateP2PTrade(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}

	var req struct {
		AdID   string  `json:"adId" binding:"required"`
		Amount float64 `json:"amount" binding:"required,gt=0"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": "Invalid request body"}})
		return
	}
	if _, err := uuid.Parse(req.AdID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": gin.H{"code": 404, "message": "Ad not found"}})
		return
	}

	ctx := c.Request.Context()
	tx, err := models.Pool.Begin(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Trade could not be created"}})
		return
	}
	defer tx.Rollback(ctx)

	var adUserID, adType, cryptoCurrency string
	var adAmount, price float64
	err = tx.QueryRow(ctx, `
		SELECT user_id, type, crypto_currency, amount, price
		FROM p2p_ads
		WHERE id = $1 AND status = 'active'
		FOR UPDATE
	`, req.AdID).Scan(&adUserID, &adType, &cryptoCurrency, &adAmount, &price)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "error": gin.H{"code": 404, "message": "Ad is not available"}})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Trade could not be created"}})
		return
	}
	if adUserID == userID {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": "You cannot trade against your own ad"}})
		return
	}
	if req.Amount > adAmount {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": "Amount exceeds the ad's remaining size"}})
		return
	}
	if price <= 0 {
		c.JSON(http.StatusConflict, gin.H{"success": false, "error": gin.H{"code": 409, "message": "Ad has an invalid price and cannot be traded"}})
		return
	}

	cryptoAmount := req.Amount / price

	// A "sell" ad means the creator sells crypto, so the taker is the buyer.
	var buyerID, sellerID string
	if adType == "sell" {
		sellerID, buyerID = adUserID, userID
	} else {
		buyerID, sellerID = adUserID, userID
	}

	tradeID := uuid.New()
	if _, err = tx.Exec(ctx, `
		INSERT INTO p2p_trades (id, p2p_ad_id, buyer_id, seller_id, amount, crypto_amount, status)
		VALUES ($1, $2, $3, $4, $5, $6, 'pending')
	`, tradeID, req.AdID, buyerID, sellerID, req.Amount, cryptoAmount); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Trade could not be created"}})
		return
	}

	if err = tx.Commit(ctx); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Trade could not be created"}})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"success": true, "data": gin.H{
		"id":             tradeID,
		"adId":           req.AdID,
		"amount":         req.Amount,
		"cryptoAmount":   cryptoAmount,
		"cryptoCurrency": cryptoCurrency,
		"status":         "pending",
	}})
}

func ConfirmP2PTrade(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}

	tradeID := c.Param("id")
	if _, err := uuid.Parse(tradeID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": gin.H{"code": 404, "message": "Trade not found"}})
		return
	}

	var buyerID, sellerID string
	err := models.Pool.QueryRow(c.Request.Context(),
		`SELECT buyer_id, seller_id FROM p2p_trades WHERE id = $1`, tradeID).Scan(&buyerID, &sellerID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": gin.H{"code": 404, "message": "Trade not found"}})
		return
	}
	if userID != buyerID && userID != sellerID {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": gin.H{"code": 403, "message": "You are not a party to this trade"}})
		return
	}

	// Confirming a trade releases escrow and moves crypto between the two
	// parties' wallets. That settlement ledger is not implemented, so fail
	// closed rather than report a confirmation that moved no funds.
	c.JSON(http.StatusNotImplemented, gin.H{"success": false, "error": gin.H{"code": 501, "message": "P2P settlement ledger is not implemented; no funds were moved"}})
}

func DisputeP2PTrade(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}

	tradeID := c.Param("id")
	if _, err := uuid.Parse(tradeID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": gin.H{"code": 404, "message": "Trade not found"}})
		return
	}

	var buyerID, sellerID string
	err := models.Pool.QueryRow(c.Request.Context(),
		`SELECT buyer_id, seller_id FROM p2p_trades WHERE id = $1`, tradeID).Scan(&buyerID, &sellerID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": gin.H{"code": 404, "message": "Trade not found"}})
		return
	}
	if userID != buyerID && userID != sellerID {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": gin.H{"code": 403, "message": "You are not a party to this trade"}})
		return
	}

	// Filing a dispute only marks the trade for review; it moves no funds.
	tag, err := models.Pool.Exec(c.Request.Context(),
		`UPDATE p2p_trades SET status = 'disputed', updated_at = NOW() WHERE id = $1`, tradeID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Dispute could not be filed"}})
		return
	}
	if tag.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": gin.H{"code": 404, "message": "Trade not found"}})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"message": "Dispute filed"}})
}

// ============ EARN ============

func GetEarnProducts(c *gin.Context) {
	rows, err := models.Pool.Query(c.Request.Context(), `
		SELECT id, name, currency, apy, min_amount, max_amount, lock_period, status 
		FROM earn_products WHERE status = 'active'
	`)

	if err != nil {
		c.JSON(200, gin.H{"success": true, "data": []gin.H{}})
		return
	}
	defer rows.Close()

	products := []gin.H{}
	for rows.Next() {
		var id, name, currency, status string
		var apy, minAmt, maxAmt *float64
		var lockPeriod int
		rows.Scan(&id, &name, &currency, &apy, &minAmt, &maxAmt, &lockPeriod, &status)
		products = append(products, gin.H{
			"id":         id,
			"name":       name,
			"currency":   currency,
			"apy":        apy,
			"minAmount":  minAmt,
			"maxAmount":  maxAmt,
			"lockPeriod": lockPeriod,
			"status":     status,
		})
	}

	c.JSON(200, gin.H{"success": true, "data": products})
}

func SubscribeEarn(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}
	// Subscribing debits the user's balance and opens a position that accrues
	// rewards. The earn ledger is not implemented, so fail closed instead of
	// reporting a subscription that locked nothing.
	c.JSON(http.StatusNotImplemented, gin.H{"success": false, "error": gin.H{"code": 501, "message": "Earn subscription ledger is not implemented; no funds were locked"}})
}

func GetEarnPositions(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}

	rows, err := models.Pool.Query(c.Request.Context(), `
		SELECT ep.id, ep.product_id, ep.amount, ep.reward, ep.start_time, ep.end_time, ep.status,
		       p.name, p.currency, p.apy
		FROM earn_positions ep
		LEFT JOIN earn_products p ON p.id = ep.product_id
		WHERE ep.user_id = $1
		ORDER BY ep.start_time DESC
	`, userID)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "error": gin.H{"code": 503, "message": "Earn positions are temporarily unavailable"}})
		return
	}
	defer rows.Close()

	positions := []gin.H{}
	for rows.Next() {
		var id, productID, status string
		var amount, reward float64
		var startTime, endTime interface{}
		var name, currency *string
		var apy *float64
		if err := rows.Scan(&id, &productID, &amount, &reward, &startTime, &endTime, &status, &name, &currency, &apy); err != nil {
			continue
		}
		positions = append(positions, gin.H{
			"id":        id,
			"productId": productID,
			"name":      name,
			"currency":  currency,
			"apy":       apy,
			"amount":    amount,
			"reward":    reward,
			"startTime": startTime,
			"endTime":   endTime,
			"status":    status,
		})
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": positions})
}

// ============ STAKING ============

func GetStakingPools(c *gin.Context) {
	rows, err := models.Pool.Query(c.Request.Context(), `
		SELECT id, name, currency, apy, lock_period, min_stake, total_staked 
		FROM staking_pools WHERE status = 'active'
	`)

	if err != nil {
		c.JSON(200, gin.H{"success": true, "data": []gin.H{}})
		return
	}
	defer rows.Close()

	pools := []gin.H{}
	for rows.Next() {
		var id, name, currency string
		var apy, minStake, totalStaked float64
		var lockPeriod int
		rows.Scan(&id, &name, &currency, &apy, &lockPeriod, &minStake, &totalStaked)
		pools = append(pools, gin.H{
			"id":          id,
			"name":        name,
			"currency":    currency,
			"apy":         apy,
			"lockPeriod":  lockPeriod,
			"minStake":    minStake,
			"totalStaked": totalStaked,
		})
	}

	c.JSON(200, gin.H{"success": true, "data": pools})
}

func Stake(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}
	// Staking locks the user's balance in a pool. The staking ledger is not
	// implemented, so fail closed rather than report a stake that locked nothing.
	c.JSON(http.StatusNotImplemented, gin.H{"success": false, "error": gin.H{"code": 501, "message": "Staking ledger is not implemented; no funds were locked"}})
}

func Unstake(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}
	// Unstaking returns principal plus rewards to the user's balance. The
	// staking ledger is not implemented, so fail closed rather than report an
	// unstake that released nothing.
	c.JSON(http.StatusNotImplemented, gin.H{"success": false, "error": gin.H{"code": 501, "message": "Staking ledger is not implemented; no funds were released"}})
}

func GetStakingPositions(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}

	rows, err := models.Pool.Query(c.Request.Context(), `
		SELECT sp.id, sp.pool_id, sp.amount, sp.reward, sp.lock_period, sp.start_time, sp.end_time, sp.status,
		       p.name, p.currency, p.apy
		FROM staking_positions sp
		LEFT JOIN staking_pools p ON p.id::text = sp.pool_id
		WHERE sp.user_id = $1
		ORDER BY sp.start_time DESC
	`, userID)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "error": gin.H{"code": 503, "message": "Staking positions are temporarily unavailable"}})
		return
	}
	defer rows.Close()

	positions := []gin.H{}
	for rows.Next() {
		var id, poolID, status string
		var amount, reward float64
		var lockPeriod int
		var startTime, endTime interface{}
		var name, currency *string
		var apy *float64
		if err := rows.Scan(&id, &poolID, &amount, &reward, &lockPeriod, &startTime, &endTime, &status, &name, &currency, &apy); err != nil {
			continue
		}
		positions = append(positions, gin.H{
			"id":         id,
			"poolId":     poolID,
			"name":       name,
			"currency":   currency,
			"apy":        apy,
			"amount":     amount,
			"reward":     reward,
			"lockPeriod": lockPeriod,
			"startTime":  startTime,
			"endTime":    endTime,
			"status":     status,
		})
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": positions})
}

// ============ LAUNCHPAD ============

func GetLaunchpadProjects(c *gin.Context) {
	rows, err := models.Pool.Query(c.Request.Context(), `
		SELECT id, name, symbol, description, total_raise, token_price, start_time, end_time, status
		FROM launchpad_projects
		ORDER BY start_time DESC NULLS LAST, created_at DESC
	`)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "error": gin.H{"code": 503, "message": "Launchpad projects are temporarily unavailable"}})
		return
	}
	defer rows.Close()

	projects := []gin.H{}
	for rows.Next() {
		var id, name, symbol, status string
		var description *string
		var totalRaise, tokenPrice *float64
		var startTime, endTime interface{}
		if err := rows.Scan(&id, &name, &symbol, &description, &totalRaise, &tokenPrice, &startTime, &endTime, &status); err != nil {
			continue
		}
		projects = append(projects, gin.H{
			"id":          id,
			"name":        name,
			"symbol":      symbol,
			"description": description,
			"totalRaise":  totalRaise,
			"tokenPrice":  tokenPrice,
			"startTime":   startTime,
			"endTime":     endTime,
			"status":      status,
		})
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": projects})
}

func SubscribeLaunchpad(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}
	// Subscribing to a launchpad commits the user's balance to an allocation.
	// The allocation ledger is not implemented, so fail closed rather than
	// report a subscription that committed nothing.
	c.JSON(http.StatusNotImplemented, gin.H{"success": false, "error": gin.H{"code": 501, "message": "Launchpad allocation ledger is not implemented; no funds were committed"}})
}

// ============ CONVERT & TRANSFER ============

func Convert(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}
	// A convert swaps one asset for another at a quoted rate. The quote and
	// swap ledger are not implemented, so fail closed rather than report a
	// conversion that exchanged nothing.
	c.JSON(http.StatusNotImplemented, gin.H{"success": false, "error": gin.H{"code": 501, "message": "Convert quote and settlement ledger are not implemented; no assets were exchanged"}})
}

func InternalTransfer(c *gin.Context) {
	if middleware.GetUserID(c) == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}
	// Never report a successful transfer without an atomic ledger transaction.
	c.JSON(http.StatusNotImplemented, gin.H{"success": false, "error": gin.H{"code": 501, "message": "Internal transfer ledger is not implemented"}})
}

func GetCoupons(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}

	rows, err := models.Pool.Query(c.Request.Context(), `
		SELECT id, amount, currency, code, status, expires_at, used_at, created_at
		FROM rewards
		WHERE user_id = $1 AND type = 'coupon'
		ORDER BY created_at DESC
	`, userID)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "error": gin.H{"code": 503, "message": "Coupons are temporarily unavailable"}})
		return
	}
	defer rows.Close()

	coupons := []gin.H{}
	for rows.Next() {
		var id, currency, status string
		var amount float64
		var code *string
		var expiresAt, usedAt, createdAt interface{}
		if err := rows.Scan(&id, &amount, &currency, &code, &status, &expiresAt, &usedAt, &createdAt); err != nil {
			continue
		}
		coupons = append(coupons, gin.H{
			"id":        id,
			"amount":    amount,
			"currency":  currency,
			"code":      code,
			"status":    status,
			"expiresAt": expiresAt,
			"usedAt":    usedAt,
			"createdAt": createdAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": coupons})
}

func ClaimCoupon(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}
	// Claiming a coupon credits the user's balance. The reward ledger is not
	// implemented, so fail closed rather than report a claim that credited nothing.
	c.JSON(http.StatusNotImplemented, gin.H{"success": false, "error": gin.H{"code": 501, "message": "Reward credit ledger is not implemented; no funds were credited"}})
}

func GetRedPackets(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}

	rows, err := models.Pool.Query(c.Request.Context(), `
		SELECT id, amount, currency, code, status, expires_at, used_at, created_at
		FROM rewards
		WHERE user_id = $1 AND type = 'red_packet'
		ORDER BY created_at DESC
	`, userID)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "error": gin.H{"code": 503, "message": "Red packets are temporarily unavailable"}})
		return
	}
	defer rows.Close()

	packets := []gin.H{}
	for rows.Next() {
		var id, currency, status string
		var amount float64
		var code *string
		var expiresAt, usedAt, createdAt interface{}
		if err := rows.Scan(&id, &amount, &currency, &code, &status, &expiresAt, &usedAt, &createdAt); err != nil {
			continue
		}
		packets = append(packets, gin.H{
			"id":        id,
			"amount":    amount,
			"currency":  currency,
			"code":      code,
			"status":    status,
			"expiresAt": expiresAt,
			"usedAt":    usedAt,
			"createdAt": createdAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": packets})
}

func OpenRedPacket(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}
	// Opening a red packet credits the user's balance. The reward ledger is not
	// implemented, so fail closed rather than return a fabricated amount.
	c.JSON(http.StatusNotImplemented, gin.H{"success": false, "error": gin.H{"code": 501, "message": "Red packet reward ledger is not implemented; no funds were credited"}})
}

// ============ WEBSOCKET ============

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return false
		}
		for _, candidate := range strings.Split(os.Getenv("TIGEREX_CORS_ORIGINS"), ",") {
			candidate = strings.TrimSpace(candidate)
			if candidate != "" && candidate != "*" && candidate == origin {
				return true
			}
		}
		return false
	},
}

var hub *WebSocketHub

type WebSocketHub struct {
	clients    map[*websocket.Conn]bool
	broadcast  chan []byte
	register   chan *websocket.Conn
	unregister chan *websocket.Conn
}

func NewWebSocketHub() *WebSocketHub {
	return &WebSocketHub{
		clients:    make(map[*websocket.Conn]bool),
		broadcast:  make(chan []byte, 256),
		register:   make(chan *websocket.Conn),
		unregister: make(chan *websocket.Conn),
	}
}

func (h *WebSocketHub) run() {
	for {
		select {
		case conn := <-h.register:
			h.clients[conn] = true
		case conn := <-h.unregister:
			if _, ok := h.clients[conn]; ok {
				delete(h.clients, conn)
				conn.Close()
			}
		case message := <-h.broadcast:
			for conn := range h.clients {
				err := conn.WriteMessage(websocket.TextMessage, message)
				if err != nil {
					conn.Close()
					delete(h.clients, conn)
				}
			}
		}
	}
}

func StartWebSocketServer() {
	hub = NewWebSocketHub()
	go hub.run()
}

// ============ HELPERS ============

func generateAddress(currency, network string) string {
	if currency == "ETH" {
		return "0x" + randomHex(40)
	}
	return randomHex(56)
}

func randomHex(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)[:n]
}

func getMemo(currency string) string {
	if currency == "XRP" || currency == "EOS" {
		return "123456"
	}
	return ""
}

func min(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

func max(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}
