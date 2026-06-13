package api

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"tigerex/backend/internal/config"
	"tigerex/backend/internal/auth"
	"tigerex/backend/internal/kyc"
	"tigerex/backend/internal/matching"
	"tigerex/backend/internal/security"
	"tigerex/backend/internal/trading"
	"tigerex/backend/internal/wallet"
)

type Router struct {
	AuthService     auth.AuthService
	KYCService     kyc.KYCService
	WalletService  wallet.WalletService
	TradingService trading.TradingService
	SecurityLayer  security.SecurityLayer
	Config        *config.Config
	mux          *http.ServeMux
}

type RouterConfig struct {
	AuthService     auth.AuthService
	KYCService     kyc.KYCService
	WalletService  wallet.WalletService
	TradingService trading.TradingService
	SecurityLayer  security.SecurityLayer
	Config        *config.Config
}

func NewRouter(cfg RouterConfig) *Router {
	r := &Router{
		AuthService:     cfg.AuthService,
		KYCService:     cfg.KYCService,
		WalletService:  cfg.WalletService,
		TradingService: cfg.TradingService,
		SecurityLayer:  cfg.SecurityLayer,
		Config:        cfg.Config,
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
		"status": "healthy",
		"timestamp": time.Now().Unix(),
		"version": "1.0.0",
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

	// KYC routes
	case "/api/v1/kyc/submit":
		r.handleKYCSubmit(w, req)
	case "/api/v1/kyc/status":
		r.handleKYCStatus(w, req)
	case "/api/v1/kyc/selfie":
		r.handleKYCSelfie(w, req)

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
		Phone   string `json:"phone"`
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
		"user":   user,
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
		"success":    true,
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
		Amount   float64 `json:"amount"`
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
		ToUser  string  `json:"to_user"`
		Symbol  string  `json:"symbol"`
		Amount  float64 `json:"amount"`
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

func (r *Router) handleOrder(w http.ResponseWriter, req *http.Request) {
	if req.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var reqBody struct {
		Symbol   string  `json:"symbol"`
		Side    string  `json:"side"`
		Type    string  `json:"type"`
		Price   float64 `json:"price"`
		Quantity float64 `json:"quantity"`
	}

	if err := json.NewDecoder(req.Body).Decode(&reqBody); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
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
		"price": "67000.00",
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

func (r *Router) handleWebSocket(w http.ResponseWriter, req *http.Request) {
	// Upgrade to WebSocket
	log.Println("WebSocket connection established")
}

func (r *Router) handleRoot(w http.ResponseWriter, req *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"name": "TigerEx API",
		"version": "1.0.0",
		"status": "running",
	})
}