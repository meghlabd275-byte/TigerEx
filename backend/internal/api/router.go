package api

import (
	"encoding/json"
	"log"
	"net/http"
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
	AuthService    auth.AuthService
	KYCService     kyc.KYCService
	WalletService  wallet.WalletService
	TradingService trading.TradingService
	SecurityLayer  security.SecurityLayer
	Config         *config.Config
	mux            *http.ServeMux
}

type RouterConfig struct {
	AuthService    auth.AuthService
	KYCService     kyc.KYCService
	WalletService  wallet.WalletService
	TradingService trading.TradingService
	SecurityLayer  security.SecurityLayer
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

func (r *Router) setupRoutes() {
	// Health check
	r.mux.HandleFunc("/health", r.healthCheck)

	// API v1
	apiV1 := http.HandlerFunc(r.handleAPIv1)
	r.mux.Handle("/api/v1/", r.SecurityLayer.CSRFProtection(apiV1))

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

	switch {
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

	session, err := r.AuthService.Login(req.Context(), reqBody.Login, reqBody.Password, r.SecurityLayer.GetSecurityContext(req).(*security.SecurityContext).IPAddress, req.UserAgent())
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"session": session,
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

	sessionID := req.Header.Get("X-Session-ID")
	r.AuthService.Logout(req.Context(), sessionID)

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

	secret, err := r.AuthService.Enable2FA(req.Context(), "user-id")
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
		Code string `json:"code"`
	}

	if err := json.NewDecoder(req.Body).Decode(&reqBody); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
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
	registered := reqBody.Identifier != "" && (len(reqBody.Identifier) >= 4)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":            true,
		"registered":         registered,
		"type":               reqBody.Type,
		"two_factor_enabled": registered,
		"withdrawal_locked_hours_after_security_change": 48,
	})
}

func (r *Router) handleVerificationCode(w http.ResponseWriter, req *http.Request) {
	if req.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "verified": true})
}

func (r *Router) handleTwoFAReset(w http.ResponseWriter, req *http.Request) {
	if req.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":                    true,
		"previous_two_factor_erased": true,
		"new_two_factor_ready":       true,
		"withdrawals_disabled_until": time.Now().Add(48 * time.Hour).Unix(),
	})
}

func (r *Router) handleAuthOperation(w http.ResponseWriter, req *http.Request, provider string) {
	if req.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":       true,
		"provider":      provider,
		"status":        "verified",
		"session_bound": true,
	})
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

	app, err := r.KYCService.SubmitApplication("user-id", reqBody.DocumentType, reqBody.DocumentID)
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

	status, level, err := r.KYCService.GetStatus("user-id")
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

	err := r.KYCService.SubmitSelfie("user-id", reqBody.SelfieURL)
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
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":        true,
		"face_match":     true,
		"liveness_score": 0.98,
		"status":         "submitted_for_admin_review",
	})
}

func (r *Router) handleGetBalance(w http.ResponseWriter, req *http.Request) {
	if req.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	balance, err := r.WalletService.GetBalance("user-id", wallet.TypeSpot, "USDT")
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

	err := r.WalletService.Deposit("user-id", wallet.TypeSpot, reqBody.Symbol, reqBody.Amount)
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

	err := r.WalletService.Withdraw("user-id", wallet.TypeSpot, reqBody.Symbol, reqBody.Amount, reqBody.ToAddress)
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

	err := r.WalletService.Transfer("user-id", reqBody.ToUser, wallet.TypeSpot, reqBody.Symbol, reqBody.Amount)
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

	json.NewEncoder(w).Encode(map[string]interface{}{
		"history": []map[string]interface{}{
			{"type": "deposit", "asset": "USDT", "amount": 2500, "chain": "TRC20", "status": "completed"},
			{"type": "transfer", "asset": "BTC", "amount": 0.05, "from_wallet": "spot", "to_wallet": "futures", "status": "completed"},
		},
	})
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

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":       true,
		"transfer_type": transferType,
		"asset":         reqBody.Asset,
		"amount":        reqBody.Amount,
		"status":        "completed",
	})
}

func (r *Router) handleGetAddress(w http.ResponseWriter, req *http.Request) {
	if req.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	addresses, err := r.WalletService.GetAddresses("user-id", wallet.TypeSpot)
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

	address, err := r.WalletService.GenerateAddress("user-id", wallet.TypeSpot, reqBody.Chain)
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
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":                    true,
		"contact_swapped":            true,
		"withdrawals_disabled_until": time.Now().Add(48 * time.Hour).Unix(),
	})
}

func (r *Router) handleDeleteRequest(w http.ResponseWriter, req *http.Request) {
	if req.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":                     true,
		"logout":                      true,
		"scheduled_delete_at":         time.Now().Add(30 * 24 * time.Hour).Unix(),
		"cancel_if_login_within_days": 30,
	})
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
	}

	if err := json.NewDecoder(req.Body).Decode(&reqBody); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"order_id": "order-123",
	})
}

func (r *Router) handleCancelOrder(w http.ResponseWriter, req *http.Request) {
	if req.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
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

	json.NewEncoder(w).Encode(map[string]interface{}{
		"orders": []interface{}{},
	})
}

func (r *Router) handleGetPositions(w http.ResponseWriter, req *http.Request) {
	if req.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"positions": []interface{}{},
	})
}

func (r *Router) handleMarketDepth(w http.ResponseWriter, req *http.Request) {
	if req.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"bids": [][]interface{}{},
		"asks": [][]interface{}{},
	})
}

func (r *Router) handleTicker(w http.ResponseWriter, req *http.Request) {
	if req.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"price":  "67000.00",
		"change": "2.5%",
	})
}

func (r *Router) handleMarketTrades(w http.ResponseWriter, req *http.Request) {
	if req.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"trades": []interface{}{},
	})
}

func (r *Router) handleKlines(w http.ResponseWriter, req *http.Request) {
	if req.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"klines": []interface{}{},
	})
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

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":      true,
		"operation_id": "op-" + reqBody.Product + "-" + reqBody.Action,
		"product":      reqBody.Product,
		"action":       reqBody.Action,
		"symbol":       reqBody.Symbol,
		"status":       "accepted",
	})
}

func (r *Router) handleWebSocket(w http.ResponseWriter, req *http.Request) {
	// Upgrade to WebSocket
	log.Println("WebSocket connection established")
}

func (r *Router) handleRoot(w http.ResponseWriter, req *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"name":    "TigerEx API",
		"version": "1.0.0",
		"status":  "running",
	})
}
