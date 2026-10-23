package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"tigerex/backend/internal/auth"
	"tigerex/backend/internal/config"
	"tigerex/backend/internal/kyc"
	"tigerex/backend/internal/matching"
	"tigerex/backend/internal/security"
	"tigerex/backend/internal/trading"
	"tigerex/backend/internal/wallet"
)

type Router struct {
	AuthService    *auth.AuthService
	KYCService     *kyc.KYCService
	WalletService  *wallet.WalletService
	TradingService *trading.TradingService
	SecurityLayer  *security.SecurityLayer
	Config         *config.Config
	mux            *http.ServeMux
}

type RouterConfig struct {
	AuthService    *auth.AuthService
	KYCService     *kyc.KYCService
	WalletService  *wallet.WalletService
	TradingService *trading.TradingService
	SecurityLayer  *security.SecurityLayer
	Config         *config.Config
}

func NewRouter(cfg RouterConfig) *Router {
	r := &Router{
		AuthService:    cfg.AuthService,
		KYCService:     cfg.KYCService,
		WalletService:  cfg.WalletService,
		TradingService: cfg.TradingService,
		SecurityLayer:  cfg.SecurityLayer,
		Config:         cfg.Config,
	}

	r.mux = http.NewServeMux()

	// Apply security middleware
	handler := r.SecurityLayer.SecureHeaders(r.mux)
	handler = r.SecurityLayer.RateLimit(handler)

	// API routes
	r.setupRoutes()

	return r
}

func (r *Router) Handler() http.Handler {
	return r.mux
}

// publicRoutes are the only API paths reachable without an authenticated
// session. Everything else requires a valid access token.
var publicRoutes = map[string]bool{
	"/api/v1/auth/login":           true,
	"/api/v1/auth/register":        true,
	"/api/v1/auth/logout":          true,
	"/api/v1/auth/refresh":         true,
	"/api/v1/auth/password/reset":  true,
	"/api/v1/auth/identifier/check": true,
	"/api/v1/auth/verify-code":     true,
	"/api/v1/auth/social":          true,
	"/api/v1/auth/metamask":        true,
	"/api/v1/auth/passkey":         true,
	"/api/v1/auth/biometric":       true,
}

type authContextKey struct{}

// authenticate resolves the bearer token and injects the caller identity
// into the request context. It fails closed: a missing or invalid token
// never reaches a protected handler.
func (r *Router) authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if publicRoutes[req.URL.Path] {
			next.ServeHTTP(w, req)
			return
		}

		header := req.Header.Get("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		claims, err := r.AuthService.ValidateToken(req.Context(), strings.TrimPrefix(header, "Bearer "))
		if err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		ctx := context.WithValue(req.Context(), authContextKey{}, claims)
		next.ServeHTTP(w, req.WithContext(ctx))
	})
}

// userID returns the authenticated caller from the request context. It
// returns an empty string when the request was not authenticated.
func userID(req *http.Request) string {
	if claims, ok := req.Context().Value(authContextKey{}).(*auth.Claims); ok && claims != nil {
		return claims.UserID
	}
	return ""
}

func (r *Router) setupRoutes() {
	// Health check
	r.mux.HandleFunc("/health", r.healthCheck)

	// API v1
	apiV1 := http.HandlerFunc(r.handleAPIv1)
	r.mux.Handle("/api/v1/", r.SecurityLayer.CSRFProtection(r.authenticate(apiV1)))

	// WebSocket
	r.mux.HandleFunc("/ws", r.handleWebSocket)

	// Static files (in production)
	r.mux.HandleFunc("/", r.handleRoot)
}

func (r *Router) healthCheck(w http.ResponseWriter, req *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "healthy",
		"timestamp": time.Now().Unix(),
		"version":   "1.0.0",
	})
}

func (r *Router) handleAPIv1(w http.ResponseWriter, req *http.Request) {
	path := req.URL.Path

	switch path {
	// Auth routes
	case "/api/v1/auth/login":
		r.handleLogin(w, req)
	case "/api/v1/auth/register":
		r.handleRegister(w, req)
	case "/api/v1/auth/logout":
		r.handleLogout(w, req)
	case "/api/v1/auth/refresh":
		r.handleRefreshToken(w, req)
	case "/api/v1/auth/2fa/enable":
		r.handleEnable2FA(w, req)
	case "/api/v1/auth/2fa/verify":
		r.handleVerify2FA(w, req)
	case "/api/v1/auth/password/reset":
		r.handlePasswordReset(w, req)
	case "/api/v1/auth/password/change":
		r.handlePasswordChange(w, req)
	case "/api/v1/auth/identifier/check":
		r.handleIdentifierCheck(w, req)
	case "/api/v1/auth/verify-code":
		r.handleVerificationCode(w, req)
	case "/api/v1/auth/2fa/reset":
		r.handleTwoFAReset(w, req)
	case "/api/v1/auth/social":
		r.handleAuthOperation(w, req, "social")
	case "/api/v1/auth/metamask":
		r.handleAuthOperation(w, req, "metamask")
	case "/api/v1/auth/passkey":
		r.handleAuthOperation(w, req, "passkey")
	case "/api/v1/auth/biometric":
		r.handleAuthOperation(w, req, "biometric")

	// KYC routes
	case "/api/v1/kyc/submit":
		r.handleKYCSubmit(w, req)
	case "/api/v1/kyc/status":
		r.handleKYCStatus(w, req)
	case "/api/v1/kyc/selfie":
		r.handleKYCSelfie(w, req)
	case "/api/v1/kyc/liveness":
		r.handleKYCLiveness(w, req)

	// Wallet routes
	case "/api/v1/wallet/balance":
		r.handleGetBalance(w, req)
	case "/api/v1/wallet/deposit":
		r.handleDeposit(w, req)
	case "/api/v1/wallet/withdraw":
		r.handleWithdraw(w, req)
	case "/api/v1/wallet/transfer":
		r.handleTransfer(w, req)
	case "/api/v1/wallet/address":
		r.handleGetAddress(w, req)
	case "/api/v1/wallet/generate-address":
		r.handleGenerateAddress(w, req)
	case "/api/v1/wallet/history":
		r.handleWalletHistory(w, req)
	case "/api/v1/wallet/internal-transfer":
		r.handleWalletTransfer(w, req, "internal")
	case "/api/v1/wallet/user-transfer":
		r.handleWalletTransfer(w, req, "user")
	case "/api/v1/account/contact-change":
		r.handleContactChange(w, req)
	case "/api/v1/account/delete-request":
		r.handleDeleteRequest(w, req)

	// Trading routes
	case "/api/v1/trading/order":
		r.handleOrder(w, req)
	case "/api/v1/trading/cancel":
		r.handleCancelOrder(w, req)
	case "/api/v1/trading/orders":
		r.handleGetOrders(w, req)
	case "/api/v1/trading/positions":
		r.handleGetPositions(w, req)

	// Market routes
	case "/api/v1/market/depth":
		r.handleMarketDepth(w, req)
	case "/api/v1/market/ticker":
		r.handleTicker(w, req)
	case "/api/v1/market/trades":
		r.handleMarketTrades(w, req)
	case "/api/v1/market/klines":
		r.handleKlines(w, req)
	case "/api/v1/features/user":
		r.handleUserFeatures(w, req)
	case "/api/v1/products/operate":
		r.handleProductOperation(w, req)

	default:
		http.Error(w, "Not Found", http.StatusNotFound)
	}
}

func (r *Router) handleLogin(w http.ResponseWriter, req *http.Request) {
	if req.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var reqBody struct {
		Login    string `json:"login"`
		Password string `json:"password"`
	}

	if err := json.NewDecoder(req.Body).Decode(&reqBody); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	ctx := req.Context()
	session, err := r.AuthService.Login(ctx, reqBody.Login, reqBody.Password, r.SecurityLayer.GetSecurityContext(req).IPAddress, req.UserAgent())
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}

	// A user with 2FA enabled receives a challenge session that must be
	// completed before an access token is issued.
	if user := r.AuthService.UserByID(session.UserID); user != nil && user.TwoFactorEnabled {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":       true,
			"two_factor":    true,
			"session_id":    session.SessionID,
			"access_token":  "",
		})
		return
	}

	accessToken, err := r.AuthService.IssueAccessToken(ctx, session)
	if err != nil {
		http.Error(w, "authentication error", http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":      true,
		"session_id":   session.SessionID,
		"access_token": accessToken,
	})
}

func (r *Router) handleRegister(w http.ResponseWriter, req *http.Request) {
	if req.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var reqBody struct {
		Email    string `json:"email"`
		Phone    string `json:"phone"`
		Username string `json:"username"`
		Password string `json:"password"`
	}

	if err := json.NewDecoder(req.Body).Decode(&reqBody); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	user, err := r.AuthService.Register(req.Context(), reqBody.Email, reqBody.Phone, reqBody.Username, reqBody.Password)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"user":    user,
	})
}

func (r *Router) handleLogout(w http.ResponseWriter, req *http.Request) {
	if req.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	claims, _ := req.Context().Value(authContextKey{}).(*auth.Claims)
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	r.AuthService.Logout(req.Context(), claims.SessionID)

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

func (r *Router) handleRefreshToken(w http.ResponseWriter, req *http.Request) {
	if req.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var reqBody struct {
		RefreshToken string `json:"refresh_token"`
	}

	if err := json.NewDecoder(req.Body).Decode(&reqBody); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	token, err := r.AuthService.RefreshToken(req.Context(), reqBody.RefreshToken)
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":      true,
		"access_token": token,
	})
}

func (r *Router) handleEnable2FA(w http.ResponseWriter, req *http.Request) {
	if req.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	uid := userID(req)
	if uid == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	secret, err := r.AuthService.Enable2FA(req.Context(), uid)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"secret":  secret,
	})
}

func (r *Router) handleVerify2FA(w http.ResponseWriter, req *http.Request) {
	if req.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var reqBody struct {
		SessionID string `json:"session_id"`
		Code      string `json:"code"`
	}

	if err := json.NewDecoder(req.Body).Decode(&reqBody); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	ctx := req.Context()
	if reqBody.SessionID != "" {
		// Completing a login challenge: exchange the code for a token.
		session, err := r.AuthService.LoginWith2FA(ctx, reqBody.SessionID, reqBody.Code)
		if err != nil {
			http.Error(w, err.Error(), http.StatusUnauthorized)
			return
		}
		accessToken, err := r.AuthService.IssueAccessToken(ctx, session)
		if err != nil {
			http.Error(w, "authentication error", http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":      true,
			"access_token": accessToken,
		})
		return
	}

	// Otherwise this confirms enrolment for the authenticated user.
	uid := userID(req)
	if uid == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if err := r.AuthService.Confirm2FA(ctx, uid, reqBody.Code); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

func (r *Router) handleIdentifierCheck(w http.ResponseWriter, req *http.Request) {
	if req.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var reqBody struct {
		Identifier string `json:"identifier"`
		Type       string `json:"type"`
	}
	if err := json.NewDecoder(req.Body).Decode(&reqBody); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	// The user directory is not queryable from this handler, so the
	// registration state cannot be reported truthfully.
	http.Error(w, "identifier lookup is unavailable", http.StatusNotImplemented)
}

func (r *Router) handleVerificationCode(w http.ResponseWriter, req *http.Request) {
	if req.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// No email/SMS delivery backend is configured, so a code can neither be
	// sent nor verified here.
	http.Error(w, "verification codes are unavailable", http.StatusNotImplemented)
}

func (r *Router) handleTwoFAReset(w http.ResponseWriter, req *http.Request) {
	if req.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// Resetting 2FA requires identity re-verification, which is not
	// implemented in this build. Refuse rather than report success.
	http.Error(w, "two-factor reset is unavailable", http.StatusNotImplemented)
}

func (r *Router) handleAuthOperation(w http.ResponseWriter, req *http.Request, provider string) {
	if req.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var reqBody struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(req.Body).Decode(&reqBody); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	// Provider integrations are not configured in this build, so the
	// credential is rejected instead of being trusted blindly.
	_ = provider
	http.Error(w, "provider authentication is unavailable", http.StatusNotImplemented)
}

func (r *Router) handlePasswordReset(w http.ResponseWriter, req *http.Request) {
	if req.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var reqBody struct {
		Email       string `json:"email"`
		ResetToken  string `json:"reset_token"`
		NewPassword string `json:"new_password"`
	}

	if err := json.NewDecoder(req.Body).Decode(&reqBody); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	err := r.AuthService.ResetPassword(req.Context(), reqBody.Email, reqBody.ResetToken, reqBody.NewPassword)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

func (r *Router) handlePasswordChange(w http.ResponseWriter, req *http.Request) {
	if req.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var reqBody struct {
		OldPassword string `json:"old_password"`
		NewPassword string `json:"new_password"`
	}

	if err := json.NewDecoder(req.Body).Decode(&reqBody); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	err := r.AuthService.ChangePassword(req.Context(), "user-id", reqBody.OldPassword, reqBody.NewPassword)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

func (r *Router) handleKYCSubmit(w http.ResponseWriter, req *http.Request) {
	if req.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var reqBody struct {
		DocumentType string `json:"document_type"`
		DocumentID   string `json:"document_id"`
	}

	if err := json.NewDecoder(req.Body).Decode(&reqBody); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	app, err := r.KYCService.SubmitApplication(userID(req), reqBody.DocumentType, reqBody.DocumentID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":     true,
		"application": app,
	})
}

func (r *Router) handleKYCStatus(w http.ResponseWriter, req *http.Request) {
	if req.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	status, level, err := r.KYCService.GetStatus(userID(req))
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": status,
		"level":  level,
	})
}

func (r *Router) handleKYCSelfie(w http.ResponseWriter, req *http.Request) {
	if req.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var reqBody struct {
		SelfieURL string `json:"selfie_url"`
	}

	if err := json.NewDecoder(req.Body).Decode(&reqBody); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	err := r.KYCService.SubmitSelfie(userID(req), reqBody.SelfieURL)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

func (r *Router) handleKYCLiveness(w http.ResponseWriter, req *http.Request) {
	if req.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	application, err := r.KYCService.GetApplication(userID(req))
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"liveness": application.LivenessResult,
		"status":   application.Status,
	})
}

func (r *Router) handleGetBalance(w http.ResponseWriter, req *http.Request) {
	if req.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	balance, err := r.WalletService.GetBalance(userID(req), wallet.TypeSpot, "USDT")
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"balance": balance,
	})
}

func (r *Router) handleDeposit(w http.ResponseWriter, req *http.Request) {
	if req.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var reqBody struct {
		Symbol string  `json:"symbol"`
		Amount float64 `json:"amount"`
	}

	if err := json.NewDecoder(req.Body).Decode(&reqBody); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	err := r.WalletService.Deposit(userID(req), wallet.TypeSpot, reqBody.Symbol, reqBody.Amount)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

func (r *Router) handleWithdraw(w http.ResponseWriter, req *http.Request) {
	if req.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var reqBody struct {
		Symbol    string  `json:"symbol"`
		Amount    float64 `json:"amount"`
		ToAddress string  `json:"to_address"`
	}

	if err := json.NewDecoder(req.Body).Decode(&reqBody); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	err := r.WalletService.Withdraw(userID(req), wallet.TypeSpot, reqBody.Symbol, reqBody.Amount, reqBody.ToAddress)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

func (r *Router) handleTransfer(w http.ResponseWriter, req *http.Request) {
	if req.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var reqBody struct {
		ToUser string  `json:"to_user"`
		Symbol string  `json:"symbol"`
		Amount float64 `json:"amount"`
	}

	if err := json.NewDecoder(req.Body).Decode(&reqBody); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	err := r.WalletService.Transfer(userID(req), reqBody.ToUser, wallet.TypeSpot, reqBody.Symbol, reqBody.Amount)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

func (r *Router) handleWalletHistory(w http.ResponseWriter, req *http.Request) {
	if req.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// No ledger backend is wired to this handler.
	http.Error(w, "wallet history is unavailable", http.StatusNotImplemented)
}

func (r *Router) handleWalletTransfer(w http.ResponseWriter, req *http.Request, transferType string) {
	if req.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var reqBody struct {
		FromWallet string  `json:"from_wallet"`
		ToWallet   string  `json:"to_wallet"`
		ToUser     string  `json:"to_user"`
		Asset      string  `json:"asset"`
		Amount     float64 `json:"amount"`
	}
	if err := json.NewDecoder(req.Body).Decode(&reqBody); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	// Wallet-to-wallet transfers are not implemented; a fabricated success
	// would misrepresent a balance change that never happened.
	_ = reqBody
	http.Error(w, "wallet transfers are unavailable", http.StatusNotImplemented)
}

func (r *Router) handleGetAddress(w http.ResponseWriter, req *http.Request) {
	if req.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	addresses, err := r.WalletService.GetAddresses(userID(req), wallet.TypeSpot)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"addresses": addresses,
	})
}

func (r *Router) handleGenerateAddress(w http.ResponseWriter, req *http.Request) {
	if req.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var reqBody struct {
		Chain string `json:"chain"`
	}

	if err := json.NewDecoder(req.Body).Decode(&reqBody); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	address, err := r.WalletService.GenerateAddress(userID(req), wallet.TypeSpot, reqBody.Chain)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"address": address,
	})
}

func (r *Router) handleContactChange(w http.ResponseWriter, req *http.Request) {
	if req.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	http.Error(w, "contact change is unavailable", http.StatusNotImplemented)
}

func (r *Router) handleDeleteRequest(w http.ResponseWriter, req *http.Request) {
	if req.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	http.Error(w, "account deletion is unavailable", http.StatusNotImplemented)
}

func (r *Router) handleOrder(w http.ResponseWriter, req *http.Request) {
	if req.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var reqBody struct {
		Symbol   string  `json:"symbol"`
		Side     string  `json:"side"`
		Type     string  `json:"type"`
		Price    float64 `json:"price"`
		Quantity float64 `json:"quantity"`
		StopPrice float64 `json:"stop_price"`
	}

	if err := json.NewDecoder(req.Body).Decode(&reqBody); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	if strings.TrimSpace(reqBody.Symbol) == "" {
		http.Error(w, "symbol is required", http.StatusBadRequest)
		return
	}
	if !(reqBody.Quantity > 0) {
		http.Error(w, "quantity must be positive", http.StatusBadRequest)
		return
	}

	var side matching.OrderSide
	switch strings.ToLower(reqBody.Side) {
	case string(matching.SideBuy):
		side = matching.SideBuy
	case string(matching.SideSell):
		side = matching.SideSell
	default:
		http.Error(w, "side must be buy or sell", http.StatusBadRequest)
		return
	}

	var orderType matching.OrderType
	switch strings.ToLower(reqBody.Type) {
	case string(matching.TypeLimit):
		orderType = matching.TypeLimit
		if !(reqBody.Price > 0) {
			http.Error(w, "price must be positive for a limit order", http.StatusBadRequest)
			return
		}
	case string(matching.TypeMarket):
		orderType = matching.TypeMarket
	default:
		http.Error(w, "unsupported order type", http.StatusBadRequest)
		return
	}

	order, err := r.TradingService.PlaceOrder(userID(req), reqBody.Symbol, side, orderType, reqBody.Price, reqBody.Quantity, reqBody.StopPrice)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"order":   order,
	})
}

func (r *Router) handleCancelOrder(w http.ResponseWriter, req *http.Request) {
	if req.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var reqBody struct {
		OrderID string `json:"order_id"`
	}
	if err := json.NewDecoder(req.Body).Decode(&reqBody); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(reqBody.OrderID) == "" {
		http.Error(w, "order_id is required", http.StatusBadRequest)
		return
	}

	if err := r.TradingService.CancelOrder(userID(req), reqBody.OrderID); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

func (r *Router) handleGetOrders(w http.ResponseWriter, req *http.Request) {
	if req.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	orders, err := r.TradingService.GetOrders(userID(req), req.URL.Query().Get("symbol"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"orders": orders,
	})
}

func (r *Router) handleGetPositions(w http.ResponseWriter, req *http.Request) {
	if req.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	positions, err := r.TradingService.GetPositions(userID(req))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"positions": positions,
	})
}

// depthLevels renders an order book side as price/quantity levels.
func depthLevels(orders []*matching.Order) []map[string]interface{} {
	levels := make([]map[string]interface{}, 0, len(orders))
	for _, o := range orders {
		if o.Status == matching.StatusCancelled || o.Remaining <= 0 {
			continue
		}
		levels = append(levels, map[string]interface{}{
			"price":    o.Price,
			"quantity": o.Remaining,
		})
	}
	return levels
}

func (r *Router) handleMarketDepth(w http.ResponseWriter, req *http.Request) {
	if req.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	symbol := req.URL.Query().Get("symbol")
	if strings.TrimSpace(symbol) == "" {
		http.Error(w, "symbol is required", http.StatusBadRequest)
		return
	}

	book, err := r.TradingService.OrderBook(symbol)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"symbol": symbol,
		"bids":   depthLevels(book.Bids),
		"asks":   depthLevels(book.Asks),
	})
}

func (r *Router) handleTicker(w http.ResponseWriter, req *http.Request) {
	if req.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	symbol := req.URL.Query().Get("symbol")
	if strings.TrimSpace(symbol) == "" {
		http.Error(w, "symbol is required", http.StatusBadRequest)
		return
	}

	book, err := r.TradingService.OrderBook(symbol)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	if book.LastPrice == 0 {
		http.Error(w, "no trades for symbol", http.StatusNotFound)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"symbol":     symbol,
		"price":      book.LastPrice,
		"updated_at": book.LastTime.Unix(),
	})
}

func (r *Router) handleMarketTrades(w http.ResponseWriter, req *http.Request) {
	if req.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// The engine does not retain a public trade tape yet.
	http.Error(w, "trade history is unavailable", http.StatusNotImplemented)
}

func (r *Router) handleKlines(w http.ResponseWriter, req *http.Request) {
	if req.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// Candle aggregation is not implemented.
	http.Error(w, "candles are unavailable", http.StatusNotImplemented)
}

func (r *Router) handleUserFeatures(w http.ResponseWriter, req *http.Request) {
	if req.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"admin_access":   false,
		"trader_control": "full",
		"markets":        []string{"market", "spot", "alpha", "futures", "margin", "options", "p2p", "tradfi", "quick_trade", "complete_trade", "pairs", "trading_pair", "pre_market"},
		"defi_etf":       []string{"launchpad", "launchpool", "staking", "earn", "etf", "liquidity_mining", "cloud_mining"},
		"wallet":         []string{"deposit", "withdraw", "transfer", "history", "addresses", "multi_currency", "multi_chain", "multi_asset"},
		"auth":           []string{"login", "register", "2fa", "kyc", "social", "metamask", "passkey", "biometric"},
		"rewards":        []string{"coupon", "red_packet"},
	})
}

func (r *Router) handleProductOperation(w http.ResponseWriter, req *http.Request) {
	if req.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var reqBody struct {
		Product string  `json:"product"`
		Action  string  `json:"action"`
		Symbol  string  `json:"symbol"`
		Side    string  `json:"side"`
		Amount  float64 `json:"amount"`
		Price   float64 `json:"price"`
	}
	if err := json.NewDecoder(req.Body).Decode(&reqBody); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	// Product operations have no backing service; reporting them as
	// accepted would confirm work that never occurs.
	_ = reqBody
	http.Error(w, "product operations are unavailable", http.StatusNotImplemented)
}

func (r *Router) handleWebSocket(w http.ResponseWriter, req *http.Request) {
	// No WebSocket upgrade is implemented on this router.
	http.Error(w, "websocket endpoint is unavailable", http.StatusNotImplemented)
}

func (r *Router) handleRoot(w http.ResponseWriter, req *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"name":    "TigerEx API",
		"version": "1.0.0",
		"status":  "running",
	})
}
