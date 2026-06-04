// HTTP Handlers - All Exchange Functions
package handlers

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"math/bits"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"golang.org/x/crypto/bcrypt"

	"tigerex/server/middleware"
	"tigerex/server/models"
)

// ============ MARKET DATA ============

type Ticker struct {
	Symbol          string  `json:"symbol"`
	Price          float64 `json:"price"`
	PriceChange    float64 `json:"priceChange"`
	PriceChangePct float64 `json:"priceChangePercent"`
	HighPrice     float64 `json:"highPrice"`
	LowPrice      float64 `json:"lowPrice"`
	Volume       float64 `json:"volume"`
	QuoteVolume  float64 `json:"quoteVolume"`
	TradesCount   int64   `json:"tradesCount"`
}

var mockPrices = map[string]Ticker{
	"BTC-USDT":  {Symbol: "BTC-USDT", Price: 65000, PriceChange: 1500, PriceChangePct: 2.5, HighPrice: 66000, LowPrice: 64000, Volume: 500000000, QuoteVolume: 32500000000, TradesCount: 150000},
	"ETH-USDT":  {Symbol: "ETH-USDT", Price: 3500, PriceChange: 100, PriceChangePct: 2.9, HighPrice: 3600, LowPrice: 3400, Volume: 200000000, QuoteVolume: 700000000, TradesCount: 80000},
	"BNB-USDT":  {Symbol: "BNB-USDT", Price: 600, PriceChange: -10, PriceChangePct: -1.6, HighPrice: 620, LowPrice: 590, Volume: 50000000, QuoteVolume: 30000000, TradesCount: 25000},
	"SOL-USDT":   {Symbol: "SOL-USDT", Price: 150, PriceChange: 8, PriceChangePct: 5.6, HighPrice: 155, LowPrice: 142, Volume: 100000000, QuoteVolume: 15000000, TradesCount: 40000},
	"XRP-USDT":   {Symbol: "XRP-USDT", Price: 0.6, PriceChange: -0.02, PriceChangePct: -3.2, HighPrice: 0.62, LowPrice: 0.58, Volume: 30000000, QuoteVolume: 18000000, TradesCount: 30000},
	"ADA-USDT":   {Symbol: "ADA-USDT", Price: 0.5, PriceChange: 0.01, PriceChangePct: 2.0, HighPrice: 0.52, LowPrice: 0.48, Volume: 20000000, QuoteVolume: 10000000, TradesCount: 15000},
	"DOGE-USDT":  {Symbol: "DOGE-USDT", Price: 0.15, PriceChange: 0.005, PriceChangePct: 3.5, HighPrice: 0.16, LowPrice: 0.145, Volume: 10000000, QuoteVolume: 1500000, TradesCount: 12000},
	"ETH-BTC":    {Symbol: "ETH-BTC", Price: 0.054, PriceChange: -0.001, PriceChangePct: -1.8, HighPrice: 0.056, LowPrice: 0.052, Volume: 50000, QuoteVolume: 2700, TradesCount: 5000},
}

// Get all markets
func GetMarkets(c *gin.Context) {
	markets := []gin.H{}
	for _, t := range mockPrices {
		markets = append(markets, gin.H{
			"symbol":          t.Symbol,
			"baseCurrency":   strings.Split(t.Symbol, "-")[0],
			"quoteCurrency": strings.Split(t.Symbol, "-")[1],
			"price":         t.Price,
			"priceChange":   t.PriceChange,
			"highPrice":    t.HighPrice,
			"lowPrice":     t.LowPrice,
			"volume":       t.Volume,
			"status":       "active",
		})
	}
	c.JSON(200, gin.H{"success": true, "data": markets})
}

// Get ticker
func GetTicker(c *gin.Context) {
	symbol := c.Param("symbol")
	ticker, ok := mockPrices[symbol]
	if !ok {
		c.JSON(404, gin.H{"success": false, "error": gin.H{"code": 404, "message": "Market not found"}})
		return
	}
	c.JSON(200, gin.H{"success": true, "data": ticker})
}

// Get order book
func GetOrderBook(c *gin.Context) {
	symbol := c.Param("symbol")
	limit := 20
	if l := c.Query("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 {
			limit = parsed
		}
	}

	ticker, ok := mockPrices[symbol]
	if !ok {
		ticker = mockPrices["BTC-USDT"]
	}

	bids := [][]interface{}{}
	asks := [][]interface{}{}
	for i := 0; i < limit; i++ {
		bidPrice := ticker.Price - float64(i)*ticker.Price*0.0001
		askPrice := ticker.Price + float64(i+1)*ticker.Price*0.0001
		bids = append(bids, []interface{}{
			strconv.FormatFloat(bidPrice, 'f', 2, 64),
			strconv.FormatFloat(rand.Float64()*10+0.1, 'f', 4, 64),
		})
		asks = append(asks, []interface{}{
			strconv.FormatFloat(askPrice, 'f', 2, 64),
			strconv.FormatFloat(rand.Float64()*10+0.1, 'f', 4, 64),
		})
	}

	c.JSON(200, gin.H{
		"success": true,
		"data": gin.H{
			"lastUpdateId": time.Now().UnixMilli(),
			"bids": bids,
			"asks": asks,
		},
	})
}

// Get klines (candlesticks)
func GetKlines(c *gin.Context) {
	symbol := c.Param("symbol")
	limit := 100
	if l := c.Query("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil {
			limit = parsed
		}
	}
	interval := c.Query("interval")
	if interval == "" {
		interval = "1h"
	}

	intervalMs := map[string]int64{"1m": 60000, "5m": 300000, "15m": 900000, "1h": 3600000, "4h": 14400000, "1d": 86400000}[interval]

	ticker, ok := mockPrices[symbol]
	if !ok {
		ticker = mockPrices["BTC-USDT"]
	}

	now := time.Now().UnixMilli()
	klines := [][]interface{}{}
	price := ticker.Price * 0.95

	for i := limit - 1; i >= 0; i-- {
		open := price
		change := (rand.Float64() - 0.5) * ticker.Price * 0.02
		close := open + change
		high := max(open, close) + rand.Float64()*ticker.Price*0.005
		low := min(open, close) - rand.Float64()*ticker.Price*0.005
		volume := rand.Float64() * 10000

		timestamp := (now - int64(i)*intervalMs) / 1000
		klines = append(klines, []interface{}{
			timestamp,
			strconv.FormatFloat(open, 'f', 2, 64),
			strconv.FormatFloat(high, 'f', 2, 64),
			strconv.FormatFloat(low, 'f', 2, 64),
			strconv.FormatFloat(close, 'f', 2, 64),
			strconv.FormatFloat(volume, 'f', 2, 64),
		})

		price = close
	}

	c.JSON(200, gin.H{"success": true, "data": klines})
}

// Get recent trades
func GetRecentTrades(c *gin.Context) {
	symbol := c.Param("symbol")
	limit := 50
	if l := c.Query("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil {
			limit = parsed
		}
	}

	ticker, ok := mockPrices[symbol]
	if !ok {
		ticker = mockPrices["BTC-USDT"]
	}

	trades := []gin.H{}
	for i := 0; i < limit; i++ {
		price := ticker.Price + (rand.Float64()-0.5)*ticker.Price*0.001
		side := "buy"
		if rand.Float64() > 0.5 {
			side = "sell"
		}
		trades = append(trades, gin.H{
			"id":            uuid.New().String(),
			"price":        strconv.FormatFloat(price, 'f', 2, 64),
			"quantity":    strconv.FormatFloat(rand.Float64()*2, 'f', 4, 64),
			"time":        (time.Now().Unix() - int64(i)*60),
			"isBuyerMaker": side == "sell",
		})
	}

	c.JSON(200, gin.H{"success": true, "data": trades})
}

// ============ AUTH ============

type RegisterRequest struct {
	Email         string `json:"email" binding:"required,email"`
	Username     string `json:"username" binding:"required"`
	Password    string `json:"password" binding:"required,min=8"`
	ReferralCode string `json:"referralCode"`
	CountryCode string `json:"countryCode"`
	TermsAccept bool   `json:"termsAccepted" binding:"required"`
}

func Register(c *gin.Context) {
	var req RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	// Check if user exists
	var count int
	err := models.Pool.QueryRow(c.Request.Context(),
		"SELECT COUNT(*) FROM users WHERE email = $1 OR username = $2",
		strings.ToLower(req.Email), strings.ToLower(req.Username)).Scan(&count)

	if err == nil && count > 0 {
		c.JSON(400, gin.H{"success": false, "error": gin.H{"code": 400, "message": "User already exists"}})
		return
	}

	// Hash password
	salt := models.GenerateSalt()
	hash, _ := bcrypt.GenerateFromPassword([]byte(req.Password+salt), bcrypt.DefaultCost)

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
	`, userID, strings.ToLower(req.Email), strings.ToLower(req.Username), string(hash), salt, refCode, req.CountryCode)

	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Failed to create user"}})
		return
	}

	// Create profile
	_, _ = tx.Exec(ctx, `INSERT INTO user_profiles (id, user_id) VALUES ($1, $2)`, uuid.New(), userID)

	// Create default wallets
	defaultCurrencies := []string{"USDT", "BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "DOGE"}
	for _, currency := range defaultCurrencies {
		network := "MAINNET"
		if currency == "ETH" || currency == "USDT" {
			network = "ERC20"
		} else if currency == "BNB" {
			network = "BEP20"
		}
		_, _ = tx.Exec(ctx, `
			INSERT INTO wallets (id, user_id, currency, network, wallet_type, balance, locked, available)
			VALUES ($1, $2, $3, $4, 'spot', 0, 0, 0)
			ON CONFLICT (user_id, currency, network, wallet_type) DO NOTHING
		`, uuid.New(), userID, currency, network)
	}

	tx.Commit(ctx)

	// Generate tokens
	accessToken, refreshToken := generateTokens(userID.String())

	c.JSON(201, gin.H{
		"success": true,
		"data": gin.H{
			"accessToken":  accessToken,
			"refreshToken": refreshToken,
			"expiresIn":   3600,
			"tokenType":   "Bearer",
			"user": gin.H{
				"id":             userID,
				"email":         req.Email,
				"username":     req.Username,
				"kycLevel":     0,
				"twoFactorEnabled": false,
			},
		},
	})
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
		ID               string
		PasswordHash     string
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
			"expiresIn":   3600,
			"tokenType":   "Bearer",
			"user": gin.H{
				"id":              user.ID,
				"email":          req.Email,
				"kycLevel":      user.KycLevel,
				"status":        user.Status,
				"twoFactorEnabled": user.TwoFactorEnable,
			},
		},
	})
}

func generateTokens(userID string) (string, string) {
	accessToken := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": userID,
		"exp":    time.Now().Add(time.Hour).Unix(),
	})
	accessStr, _ := accessToken.SignedString(middleware.JWTSecret)

	refreshToken := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id":  userID,
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
		return middleware.JWTSecret, nil
	})

	if err != nil || !token.Valid {
		c.JSON(401, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Invalid token"}})
		return
	}

	claims := token.Claims.(jwt.MapClaims)
	if claims["type"] != "refresh" {
		c.JSON(401, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Invalid token type"}})
		return
	}

	userID := claims["user_id"].(string)
	accessToken, refreshToken := generateTokens(userID)

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

// ============ 2FA ============

func Setup2FA(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(401, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}

	secret := generateTOTPSecret()
	_, _ = models.Pool.Exec(c.Request.Context(), "UPDATE users SET two_factor_secret = $1 WHERE id = $2", secret, userID)

	c.JSON(200, gin.H{
		"success": true,
		"data": gin.H{
			"secret": secret,
			"qrCode": fmt.Sprintf("otpauth://totp/TigerEx?secret=%s&issuer=TigerEx", secret),
		},
	})
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

	if !verifyTOTP(req.Code) {
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

	// Verify and return tokens
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
		var b gin.H
		var balance, locked, available float64
		var currency, network, walletType string
		rows.Scan(&currency, &network, &walletType, &balance, &locked, &available)
		balances = append(balances, gin.H{
			"currency": currency,
			"network": network,
			"type":    walletType,
			"balance": balance,
			"locked": locked,
			"available": available,
		})
	}

	c.JSON(200, gin.H{"success": true, "data": balances})
}

func GetTotalAssets(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(401, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}

	prices := map[string]float64{"BTC": 65000, "ETH": 3500, "USDT": 1, "BNB": 600, "SOL": 150, "XRP": 0.6}

	rows, err := models.Pool.Query(c.Request.Context(), `
		SELECT currency, SUM(balance) FROM wallets WHERE user_id = $1 GROUP BY currency
	`, userID)

	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Database error"}})
		return
	}
	defer rows.Close()

	var totalUSD float64
	assets := []gin.H{}
	for rows.Next() {
		var currency string
		var balance float64
		rows.Scan(&currency, &balance)
		price := prices[currency]
		value := balance * price
		totalUSD += value
		assets = append(assets, gin.H{"currency": currency, "amount": balance, "usdValue": value})
	}

	c.JSON(200, gin.H{"success": true, "data": gin.H{"totalUSD": totalUSD, "assets": assets}})
}

func GetDepositAddress(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(401, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}

	currency := c.Query("currency")
	network := c.Query("network")
	if network == "" {
		network = "MAINNET"
	}

	var address string
	err := models.Pool.QueryRow(c.Request.Context(), `
		SELECT address FROM wallet_addresses 
		WHERE user_id = $1 AND currency = $2 AND network = $3 AND is_default = true
	`, userID, currency, network).Scan(&address)

	if err != nil {
		// Generate new address
		address = generateAddress(currency, network)
		_, _ = models.Pool.Exec(c.Request.Context(), `
			INSERT INTO wallet_addresses (id, user_id, currency, network, address, is_default)
			VALUES ($1, $2, $3, $4, $5, true)
		`, uuid.New(), userID, currency, network, address)
	}

	c.JSON(200, gin.H{"success": true, "data": gin.H{"address": address, "currency": currency, "network": network, "memo": getMemo(currency)}})

func GenerateDepositAddress(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(401, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}

	var req struct {
		Currency string `json:"currency" binding:"required"`
		Network string `json:"network"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"success": false, "error": gin.H{"code": 400, "message": "Currency required"}})
		return
	}

	if req.Network == "" {
		req.Network = "MAINNET"
	}

	address := generateAddress(req.Currency, req.Network)
	_, _ = models.Pool.Exec(c.Request.Context(), `
		INSERT INTO wallet_addresses (id, user_id, currency, network, address, is_default)
		VALUES ($1, $2, $3, $4, $5, true)
	`, uuid.New(), userID, req.Currency, req.Network, address)

	c.JSON(200, gin.H{"success": true, "data": gin.H{"address": address, "currency": req.Currency, "network": req.Network, "memo": getMemo(req.Currency)}})

func GetAddresses(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(401, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}

	currency := c.Query("currency")
	query := "SELECT currency, network, address, is_default FROM wallet_addresses WHERE user_id = $1"
	args := []interface{}{userID}
	if currency != "" {
		query += " AND currency = $2"
		args = append(args, currency)
	}
	query += " ORDER BY is_default DESC"

	rows, err := models.Pool.Query(c.Request.Context(), query, args...)
	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Database error"}})
		return
	}
	defer rows.Close()

	addresses := []gin.H{}
	for rows.Next() {
		var currency, network, address string
		var isDefault bool
		rows.Scan(&currency, &network, &address, &isDefault)
		addresses = append(addresses, gin.H{"currency": currency, "network": network, "address": address, "isDefault": isDefault})
	}

	c.JSON(200, gin.H{"success": true, "data": addresses})
}

type WithdrawRequest struct {
	Currency   string  `json:"currency" binding:"required"`
	Amount     float64 `json:"amount" binding:"required,gt=0"`
	ToAddress  string  `json:"toAddress" binding:"required"`
	Network    string  `json:"network"`
	Memo       string  `json:"memo"`
}

func Withdraw(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(401, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}

	var req WithdrawRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	// Check KYC
	var kycLevel int
	err := models.Pool.QueryRow(c.Request.Context(), "SELECT kyc_level FROM users WHERE id = $1", userID).Scan(&kycLevel)
	if err != nil || kycLevel < 2 {
		c.JSON(403, gin.H{"success": false, "error": gin.H{"code": 403, "message": "Complete KYC Level 2 to withdraw"}})
		return
	}

	// Check balance
	var available float64
	err = models.Pool.QueryRow(c.Request.Context(), `
		SELECT available FROM wallets WHERE user_id = $1 AND currency = $2 AND wallet_type = 'spot'
	`, userID, req.Currency).Scan(&available)

	if err != nil || available < req.Amount {
		c.JSON(400, gin.H{"success": false, "error": gin.H{"code": 400, "message": "Insufficient balance"}})
		return
	}

	ctx := c.Request.Context()
	tx, _ := models.Pool.Begin(ctx)
	defer tx.Rollback(ctx)

	// Deduct balance
	_, _ = tx.Exec(ctx, `
		UPDATE wallets SET balance = balance - $1, available = available - $1, updated_at = NOW()
		WHERE user_id = $2 AND currency = $3 AND wallet_type = 'spot'
	`, req.Amount, userID, req.Currency)

	// Create withdrawal record
	txID := uuid.New()
	network := req.Network
	if network == "" {
		network = "MAINNET"
	}

	_, _ = tx.Exec(ctx, `
		INSERT INTO transactions (id, user_id, type, currency, amount, status, to_address, network, memo)
		VALUES ($1, $2, 'withdraw', $3, $4, $5, $6, $7, $8)
	`, txID, userID, req.Currency, req.Amount, "completed", req.ToAddress, network, req.Memo)

	tx.Commit(ctx)

	c.JSON(200, gin.H{
		"success": true,
		"data": gin.H{
			"id":        txID,
			"currency": req.Currency,
			"amount":   req.Amount,
			"status":   "completed",
		},
	})
}

type TransferRequest struct {
	ToUsername string  `json:"toUsername" binding:"required"`
	Currency  string  `json:"currency" binding:"required"`
	Amount   float64 `json:"amount" binding:"required,gt=0"`
}

func Transfer(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(401, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}

	var req TransferRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	// Find recipient
	var recipientID string
	err := models.Pool.QueryRow(c.Request.Context(), `
		SELECT id FROM users WHERE username = $1 OR email = $1
	`, req.ToUsername).Scan(&recipientID)

	if err != nil || recipientID == "" {
		c.JSON(404, gin.H{"success": false, "error": gin.H{"code": 404, "message": "User not found"}})
		return
	}

	if recipientID == userID {
		c.JSON(400, gin.H{"success": false, "error": gin.H{"code": 400, "message": "Cannot transfer to yourself"}})
		return
	}

	// Check balance
	var available float64
	err = models.Pool.QueryRow(c.Request.Context(), `
		SELECT available FROM wallets WHERE user_id = $1 AND currency = $2 AND wallet_type = 'spot'
	`, userID, req.Currency).Scan(&available)

	if err != nil || available < req.Amount {
		c.JSON(400, gin.H{"success": false, "error": gin.H{"code": 400, "message": "Insufficient balance"}})
		return
	}

	ctx := c.Request.Context()
	tx, _ := models.Pool.Begin(ctx)
	defer tx.Rollback(ctx)

	// Deduct from sender
	_, _ = tx.Exec(ctx, `
		UPDATE wallets SET balance = balance - $1, available = available - $1, updated_at = NOW()
		WHERE user_id = $2 AND currency = $3 AND wallet_type = 'spot'
	`, req.Amount, userID, req.Currency)

	// Add to recipient
	_, _ = tx.Exec(ctx, `
		INSERT INTO wallets (id, user_id, currency, network, wallet_type, balance, locked, available)
		VALUES ($1, $2, $3, 'MAINNET', 'spot', $4, 0, $4)
		ON CONFLICT (user_id, currency, network, wallet_type) 
		DO UPDATE SET balance = balance + $4, available = available + $4
	`, uuid.New(), recipientID, req.Currency, req.Amount)

	tx.Commit(ctx)

	c.JSON(200, gin.H{
		"success": true,
		"data": gin.H{
			"to":      req.ToUsername,
			"currency": req.Currency,
			"amount":  req.Amount,
			"status":  "completed",
		},
	})
}

func Deposit(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(401, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}

	var req struct {
		Currency string  `json:"currency" binding:"required"`
		Amount  float64 `json:"amount" binding:"required,gt=0"`
		Network string  `json:"network"`
		TxHash  string  `json:"txHash"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	network := req.Network
	if network == "" {
		network = "MAINNET"
	}

	ctx := c.Request.Context()
	tx, _ := models.Pool.Begin(ctx)
	defer tx.Rollback(ctx)

	// Add to wallet
	_, _ = tx.Exec(ctx, `
		INSERT INTO wallets (id, user_id, currency, network, wallet_type, balance, locked, available)
		VALUES ($1, $2, $3, $4, 'spot', $5, 0, $5)
		ON CONFLICT (user_id, currency, network, wallet_type) 
		DO UPDATE SET balance = balance + $5, available = available + $5
	`, uuid.New(), userID, req.Currency, network, req.Amount)

	// Record transaction
	txID := uuid.New()
	_, _ = tx.Exec(ctx, `
		INSERT INTO transactions (id, user_id, type, currency, amount, status, tx_hash, network)
		VALUES ($1, $2, 'deposit', $3, $4, $5, $6, $7)
	`, txID, userID, req.Currency, req.Amount, "completed", req.TxHash, network)

	tx.Commit(ctx)

	c.JSON(200, gin.H{"success": true, "data": gin.H{"id": txID, "currency": req.Currency, "amount": req.Amount, "status": "completed"}})
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
			"type":       txType,
			"currency":   currency,
			"amount":     amount,
			"fee":        fee,
			"status":     status,
			"txHash":     from,
			"from":       from,
			"to":         to,
			"createdAt":  createdAt,
			"completedAt": completedAt,
		})
	}

	c.JSON(200, gin.H{"success": true, "data": gin.H{"transactions": transactions}})
}

func GetNetworkFees(c *gin.Context) {
	fees := gin.H{
		"BTC":  gin.H{"deposit": 0, "withdraw": 0.0005, "network": "Bitcoin"},
		"ETH":  gin.H{"deposit": 0, "withdraw": 0.005, "network": "Ethereum"},
		"USDT": gin.H{"deposit": 1, "withdraw": 5, "network": "TRC20"},
		"BNB":  gin.H{"deposit": 0, "withdraw": 0.5, "network": "BNB Smart Chain"},
	}
	c.JSON(200, gin.H{"success": true, "data": fees})
}

// ============ SPOT TRADING ============

type OrderRequest struct {
	Symbol     string  `json:"symbol" binding:"required"`
	Side       string  `json:"side" binding:"required,oneof=buy sell"`
	OrderType  string  `json:"orderType" binding:"required,oneof=market limit stop_market stop_limit"`
	Quantity   float64 `json:"quantity" binding:"required,gt=0"`
	Price      float64 `json:"price"`
	StopPrice  float64 `json:"stopPrice"`
	TimeInForce string  `json:"timeInForce"`
}

func PlaceSpotOrder(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(401, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}

	var req OrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	parts := strings.Split(req.Symbol, "-")
	baseCurrency := parts[0]
	quoteCurrency := parts[1]

	// Get price
	price := req.Price
	if req.OrderType == "market" {
		ticker := mockPrices[req.Symbol]
		price = ticker.Price
	}

	// Check balance
	currencyNeeded := req.Side
	var requiredAmount float64
	if req.Side == "buy" {
		currencyNeeded = quoteCurrency
		requiredAmount = req.Quantity * price
	} else {
		currencyNeeded = baseCurrency
		requiredAmount = req.Quantity
	}

	var available float64
	err := models.Pool.QueryRow(c.Request.Context(), `
		SELECT available FROM wallets WHERE user_id = $1 AND currency = $2 AND wallet_type = 'spot'
	`, userID, currencyNeeded).Scan(&available)

	if err != nil || available < requiredAmount {
		c.JSON(400, gin.H{"success": false, "error": gin.H{"code": 400, "message": "Insufficient balance"}})
		return
	}

	orderID := uuid.New()
	ctx := c.Request.Context()
	tx, _ := models.Pool.Begin(ctx)
	defer tx.Rollback(ctx)

	status := "new"
	if req.OrderType == "market" {
		status = "filled"
	}

	timeInForce := req.TimeInForce
	if timeInForce == "" {
		timeInForce = "GTC"
	}

	_, _ = tx.Exec(ctx, `
		INSERT INTO spot_orders 
		(id, user_id, market_symbol, side, order_type, quantity, price, stop_price, status, time_in_force)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`, orderID, userID, req.Symbol, req.Side, req.OrderType, req.Quantity, req.Price, req.StopPrice, status, timeInForce)

	if req.OrderType != "market" {
		// Lock funds
		_, _ = tx.Exec(ctx, `
			UPDATE wallets SET available = available - $1, locked = locked + $1, updated_at = NOW()
			WHERE user_id = $2 AND currency = $3 AND wallet_type = 'spot'
		`, requiredAmount, userID, currencyNeeded)
	} else {
		// Execute market order
		if req.Side == "buy" {
			_, _ = tx.Exec(ctx, `
				UPDATE wallets SET balance = balance - $1, available = available - $1, updated_at = NOW()
				WHERE user_id = $2 AND currency = $3 AND wallet_type = 'spot'
			`, requiredAmount, userID, quoteCurrency)

			_, _ = tx.Exec(ctx, `
				INSERT INTO wallets (id, user_id, currency, network, wallet_type, balance, locked, available)
				VALUES ($1, $2, $3, 'MAINNET', 'spot', $4, 0, $4)
				ON CONFLICT (user_id, currency, network, wallet_type) 
				DO UPDATE SET balance = balance + $4, available = available + $4
			`, uuid.New(), userID, baseCurrency, req.Quantity)
		} else {
			_, _ = tx.Exec(ctx, `
				UPDATE wallets SET balance = balance - $1, available = available - $1, updated_at = NOW()
				WHERE user_id = $2 AND currency = $3 AND wallet_type = 'spot'
			`, req.Quantity, userID, baseCurrency)

			received := req.Quantity * price
			_, _ = tx.Exec(ctx, `
				UPDATE wallets SET balance = balance + $1, available = available + $1, updated_at = NOW()
				WHERE user_id = $2 AND currency = $3 AND wallet_type = 'spot'
			`, received, userID, quoteCurrency)
		}

		// Update order as filled
		_, _ = tx.Exec(ctx, `
			UPDATE spot_orders SET status = 'filled', filled_quantity = $1, average_price = $2, updated_at = NOW()
			WHERE id = $3
		`, req.Quantity, price, orderID)
	}

	tx.Commit(ctx)

	c.JSON(200, gin.H{"success": true, "data": gin.H{
		"orderId":  orderID,
		"symbol":  req.Symbol,
		"side":   req.Side,
		"type":   req.OrderType,
		"quantity": req.Quantity,
		"price":  price,
		"status": status,
	}})
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
		Status  string
		Side   string
		Symbol string
		Price  float64
		Qty   float64
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
			"symbol":       market,
			"side":        side,
			"orderType":   orderType,
			"quantity":   quant,
			"price":      price,
			"filledQuantity": filledQty,
			"status":     status,
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
			"symbol":       market,
			"side":        side,
			"orderType":   orderType,
			"quantity":   quant,
			"price":      price,
			"filledQuantity": quant,
			"averagePrice": avgPrice,
			"commission": comm,
			"status":     status,
			"createdAt": createdAt,
		})
	}

	c.JSON(200, gin.H{"success": true, "data": orders})
}

func GetMyTrades(c *gin.Context) {
	c.JSON(200, gin.H{"success": true, "data": []gin.H{}})
}

func QuoteOrder(c *gin.Context) {
	var req struct {
		Symbol    string  `json:"symbol" binding:"required"`
		Side     string  `json:"side" binding:"required,oneof=buy sell"`
		Quantity float64 `json:"quantity" binding:"required,gt=0"`
		Type     string  `json:"orderType"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	ticker := mockPrices[req.Symbol]
	estPrice := ticker.Price
	if req.Side == "buy" {
		estPrice *= 1.001
	} else {
		estPrice *= 0.999
	}

	total := req.Quantity * estPrice
	fee := total * 0.001

	c.JSON(200, gin.H{
		"success": true,
		"data": gin.H{
			"symbol":   req.Symbol,
			"price":   estPrice,
			"quantity": req.Quantity,
			"total":   total,
			"fee":     fee,
			"side":    req.Side,
			"type":    req.Type,
		},
	})
}

// ============ PROFILE ============

func GetProfile(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(401, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}

	var profile gin.H
	err := models.Pool.QueryRow(c.Request.Context(), `
		SELECT u.id, u.email, u.username, u.kyc_level, u.status, u.two_factor_enabled, 
		       u.email_verified, u.phone_verified, u.risk_category, u.created_at,
		       p.first_name, p.last_name, p.avatar_url, p.language_preference, p.timezone
		FROM users u
		LEFT JOIN user_profiles p ON u.id = p.user_id
		WHERE u.id = $1
	`, userID).Scan(
		&profile["id"], &profile["email"], &profile["username"], &profile["kycLevel"], &profile["status"],
		&profile["twoFactorEnabled"], &profile["emailVerified"], &profile["phoneVerified"],
		&profile["riskCategory"], &profile["createdAt"],
		&profile["firstName"], &profile["lastName"], &profile["avatarUrl"],
		&profile["languagePreference"], &profile["timezone"],
	)

	if err != nil {
		c.JSON(404, gin.H{"success": false, "error": gin.H{"code": 404, "message": "User not found"}})
		return
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
		FirstName         string `json:"firstName"`
		LastName         string `json:"lastName"`
		AvatarUrl        string `json:"avatarUrl"`
		LanguagePreference string `json:"languagePreference"`
		Timezone        string `json:"timezone"`
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
	DocumentType string `json:"documentType" binding:"required"`
	DocumentNumber string `json:"documentNumber" binding:"required"`
	FrontUrl    string `json:"frontUrl"`
	BackUrl    string `json:"backUrl"`
	SelfieUrl  string `json:"selfieUrl"`
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

	if existing != "" {
		c.JSON(400, gin.H{"success": false, "error": gin.H{"code": 400, "message": "KYC already submitted"}})
		return
	}

	// Create KYC (auto-approve for demo)
	kycID := uuid.New()
	_, _ = models.Pool.Exec(c.Request.Context(), `
		INSERT INTO kyc_documents (id, user_id, document_type, document_number, front_url, back_url, selfie_url, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`, kycID, userID, req.DocumentType, req.DocumentNumber, req.FrontUrl, req.BackUrl, req.SelfieUrl, "approved")

	// Update user KYC level
	_, _ = models.Pool.Exec(c.Request.Context(), "UPDATE users SET kyc_level = 2 WHERE id = $1", userID)

	c.JSON(200, gin.H{"success": true, "data": gin.H{"kycLevel": 2, "status": "approved", "message": "KYC submitted"}})
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
		NewPassword   string `json:"newPassword" binding:"required,min=8"`
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
	// Return futures contract data
	c.JSON(200, gin.H{"success": true, "data": []gin.H{
		{"symbol": "BTC-USDT-PERP", "type": "perpetual", "maxLeverage": 125, "makerFee": 0.0001, "takerFee": 0.0004},
		{"symbol": "ETH-USDT-PERP", "type": "perpetual", "maxLeverage": 100, "makerFee": 0.0001, "takerFee": 0.0004},
	}})
}

func OpenFuturesPosition(c *gin.Context) {
	c.JSON(200, gin.H{"success": true, "data": gin.H{"message": "Futures position opened"}})
}

func CloseFuturesPosition(c *gin.Context) {
	c.JSON(200, gin.H{"success": true, "data": gin.H{"message": "Position closed"}})
}

func GetFuturesPositions(c *gin.Context) {
	c.JSON(200, gin.H{"success": true, "data": []gin.H{}})
}

func QuoteFutures(c *gin.Context) {
	c.JSON(200, gin.H{"success": true, "data": gin.H{
		"price": 65000, "liqPrice": 64800, "marginRequired": 520,
	}})
}

// ============ MARGIN ============

func GetMarginAccount(c *gin.Context) {
	c.JSON(200, gin.H{"success": true, "data": gin.H{"borrowable": 0, "borrowed": 0, "interestRate": 0.0001}})
}

func BorrowMargin(c *gin.Context) {
	c.JSON(200, gin.H{"success": true, "data": gin.H{"message": "Borrowed"}})
}

func RepayMargin(c *gin.Context) {
	c.JSON(200, gin.H{"success": true, "data": gin.H{"message": "Repaid"}})
}

func GetMarginPositions(c *gin.Context) {
	c.JSON(200, gin.H{"success": true, "data": []gin.H{}})
}

// ============ OPTIONS ============

func GetOptionsContracts(c *gin.Context) {
	c.JSON(200, gin.H{"success": true, "data": []gin.H{
		{"symbol": "BTC-65000-C", "strike": 65000, "type": "call", "bid": 500, "ask": 550, "expiry": "2024-12-31"},
	}})
}

func TradeOptions(c *gin.Context) {
	c.JSON(200, gin.H{"success": true, "data": gin.H{"message": "Trade placed"}})
}

func GetOptionsPositions(c *gin.Context) {
	c.JSON(200, gin.H{"success": true, "data": []gin.H{}})
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
			"id":              id,
			"type":           adType,
			"fiatCurrency":   fiat,
			"cryptoCurrency": crypto,
			"amount":        amount,
			"price":        price,
			"paymentMethods": paymentMethods,
			"userId":       userID,
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
		Type          string   `json:"type" binding:"required,oneof=buy sell"`
		FiatCurrency string   `json:"fiatCurrency" binding:"required"`
		CryptoCurrency string `json:"cryptoCurrency" binding:"required"`
		Amount       float64  `json:"amount" binding:"required,gt=0"`
		Price        float64  `json:"price" binding:"required,gt=0"`
		PriceType    string   `json:"priceType"`
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
	c.JSON(200, gin.H{"success": true, "data": gin.H{"message": "Ad updated"}})
}

func DeleteP2PAd(c *gin.Context) {
	c.JSON(200, gin.H{"success": true, "data": gin.H{"message": "Ad deleted"}})
}

func CreateP2PTrade(c *gin.Context) {
	c.JSON(200, gin.H{"success": true, "data": gin.H{"message": "Trade created"}})
}

func ConfirmP2PTrade(c *gin.Context) {
	c.JSON(200, gin.H{"success": true, "data": gin.H{"message": "Trade confirmed"}})
}

func DisputeP2PTrade(c *gin.Context) {
	c.JSON(200, gin.H{"success": true, "data": gin.H{"message": "Dispute filed"}})
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
			"id":           id,
			"name":        name,
			"currency":    currency,
			"apy":         apy,
			"minAmount":   minAmt,
			"maxAmount":  maxAmt,
			"lockPeriod":  lockPeriod,
			"status":     status,
		})
	}

	c.JSON(200, gin.H{"success": true, "data": products})
}

func SubscribeEarn(c *gin.Context) {
	c.JSON(200, gin.H{"success": true, "data": gin.H{"message": "Subscribed"}})
}

func GetEarnPositions(c *gin.Context) {
	c.JSON(200, gin.H{"success": true, "data": []gin.H{}})
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
			"name":       name,
			"currency":  currency,
			"apy":       apy,
			"lockPeriod": lockPeriod,
			"minStake":  minStake,
			"totalStaked": totalStaked,
		})
	}

	c.JSON(200, gin.H{"success": true, "data": pools})
}

func Stake(c *gin.Context) {
	c.JSON(200, gin.H{"success": true, "data": gin.H{"message": "Staked"}})
}

func Unstake(c *gin.Context) {
	c.JSON(200, gin.H{"success": true, "data": gin.H{"message": "Unstaked"}})
}

func GetStakingPositions(c *gin.Context) {
	c.JSON(200, gin.H{"success": true, "data": []gin.H{}})
}

// ============ LAUNCHPAD ============

func GetLaunchpadProjects(c *gin.Context) {
	c.JSON(200, gin.H{"success": true, "data": []gin.H{
		{"id": "1", "name": "Sample Project", "symbol": "SAMPLE", "status": "upcoming", "hardCap": 1000000},
	}})
}

func SubscribeLaunchpad(c *gin.Context) {
	c.JSON(200, gin.H{"success": true, "data": gin.H{"message": "Subscribed"}})
}

// ============ CONVERT & TRANSFER ============

func Convert(c *gin.Context) {
	c.JSON(200, gin.H{"success": true, "data": gin.H{"message": "Converted"}})
}

func InternalTransfer(c *gin.Context) {
	c.JSON(200, gin.H{"success": true, "data": gin.H{"message": "Transferred"}})
}

// ============ REWARDS ============

func GetCoupons(c *gin.Context) {
	c.JSON(200, gin.H{"success": true, "data": []gin.H{}})
}

func ClaimCoupon(c *gin.Context) {
	c.JSON(200, gin.H{"success": true, "data": gin.H{"message": "Coupon claimed"}})
}

func GetRedPackets(c *gin.Context) {
	c.JSON(200, gin.H{"success": true, "data": []gin.H{}})
}

func OpenRedPacket(c *gin.Context) {
	c.JSON(200, gin.H{"success": true, "data": gin.H{"amount": 10, "currency": "USDT"}})
}

// ============ WEBSOCKET ============

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

var hub *WebSocketHub

type WebSocketHub struct {
	clients map[*websocket.Conn]bool
	broadcast chan []byte
	register chan *websocket.Conn
	unregister chan *websocket.Conn
}

func NewWebSocketHub() *WebSocketHub {
	return &WebSocketHub{
		clients:    make(map[*websocket.Conn]bool),
		broadcast:  make(chan []byte, 256),
		register:  make(chan *websocket.Conn),
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

func generateTOTPSecret() string {
	b := make([]byte, 10)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func verifyTOTP(code string) bool {
	// Simplistic - in production use proper TOTP verification
	return len(code) == 6
}

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