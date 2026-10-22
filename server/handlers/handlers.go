// HTTP Handlers - All Exchange Functions
package handlers

import (
	"encoding/hex"
	"math/rand"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
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
		"error": gin.H{"code": 503, "message": "Live market data provider is not configured; synthetic market data is disabled"},
	})
}
func GetOrderBook(c *gin.Context) {
	c.JSON(http.StatusServiceUnavailable, gin.H{
		"success": false,
		"error": gin.H{"code": 503, "message": "Live market data provider is not configured; synthetic market data is disabled"},
	})
}
func GetKlines(c *gin.Context) {
	c.JSON(http.StatusServiceUnavailable, gin.H{
		"success": false,
		"error": gin.H{"code": 503, "message": "Live market data provider is not configured; synthetic market data is disabled"},
	})
}
func GetRecentTrades(c *gin.Context) {
	c.JSON(http.StatusServiceUnavailable, gin.H{
		"success": false,
		"error": gin.H{"code": 503, "message": "Live market data provider is not configured; synthetic market data is disabled"},
	})
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
	`, userID, strings.ToLower(req.Email), strings.ToLower(req.Username), string(hash), salt, refCode, req.CountryCode)

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
		"error": gin.H{"code": 503, "message": "Spot order execution is unavailable until the durable matching engine and ledger are configured"},
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
	c.JSON(200, gin.H{"success": true, "data": []gin.H{}})
}

func QuoteOrder(c *gin.Context) {
	// Quotes must come from the same live market data and risk services that
	// validate orders. Never calculate a quote from a hard-coded reference price.
	c.JSON(http.StatusServiceUnavailable, gin.H{
		"success": false,
		"error": gin.H{"code": 503, "message": "Order quoting is unavailable until live market data and risk checks are configured"},
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
	_ = models.Pool.QueryRow(c.Request.Context(), `
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
		FROM futures_contracts
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
		"error": gin.H{"code": 503, "message": "Futures execution is unavailable until the durable matching and risk engine is configured"},
	})
}
func CloseFuturesPosition(c *gin.Context) {
	c.JSON(http.StatusServiceUnavailable, gin.H{
		"success": false,
		"error": gin.H{"code": 503, "message": "Futures execution is unavailable until the durable matching and risk engine is configured"},
	})
}
func GetFuturesPositions(c *gin.Context) {
	c.JSON(200, gin.H{"success": true, "data": []gin.H{}})
}

func QuoteFutures(c *gin.Context) {
	c.JSON(http.StatusServiceUnavailable, gin.H{
		"success": false,
		"error": gin.H{"code": 503, "message": "Futures execution is unavailable until the durable matching and risk engine is configured"},
	})
}
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
	if middleware.GetUserID(c) == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return
	}
	// Never report a successful transfer without an atomic ledger transaction.
	c.JSON(http.StatusNotImplemented, gin.H{"success": false, "error": gin.H{"code": 501, "message": "Internal transfer ledger is not implemented"}})
}

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
