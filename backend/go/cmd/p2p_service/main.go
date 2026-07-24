package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
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

type P2PAd struct {
	ID              string    `json:"id"`
	OwnerID         string    `json:"owner_id"`
	Type            string    `json:"type"` // "buy" or "sell"
	Asset           string    `json:"asset"`
	FiatCurrency    string    `json:"fiat_currency"`
	PriceType       string    `json:"price_type"` // "fixed" or "float"
	PriceMargin     float64   `json:"price_margin"` // Percentage margin for floating price
	FixedPrice      float64   `json:"fixed_price"`
	MinAmount       float64   `json:"min_amount"`
	MaxAmount       float64   `json:"max_amount"`
	PaymentMethod   string    `json:"payment_method"`
	Terms           string    `json:"terms"`
	Status          string    `json:"status"` // "active", "paused", "cancelled"
	TradeCount      int       `json:"trade_count"`
	CompletionRate   float64   `json:"completion_rate"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type P2POrder struct {
	ID              string    `json:"id"`
	AdID            string    `json:"ad_id"`
	BuyerID         string    `json:"buyer_id"`
	SellerID        string    `json:"seller_id"`
	Asset           string    `json:"asset"`
	FiatAmount      float64   `json:"fiat_amount"`
	CryptoAmount    float64   `json:"crypto_amount"`
	CryptoPrice     float64   `json:"crypto_price"`
	Status          string    `json:"status"` // "pending", "paid", "released", "cancelled", "disputed"
	PaymentProof    string    `json:"payment_proof"`
	ReleaseTxHash   string    `json:"release_tx_hash"`
	DisputeReason   string    `json:"dispute_reason"`
	CreatedAt       time.Time `json:"created_at"`
	PaidAt          *time.Time `json:"paid_at"`
	ReleasedAt      *time.Time `json:"released_at"`
}

type User struct {
	ID              string    `json:"id"`
	Email           string    `json:"email"`
	Username        string    `json:"username"`
	PasswordHash    string    `json:"-"`
	Role            string    `json:"role"` // "user", "admin"
	KYCLevel        int       `json:"kyc_level"`
	TradeCount      int       `json:"trade_count"`
	CompletionRate  float64   `json:"completion_rate"`
	AvgReleaseTime  float64   `json:"avg_release_time"` // in minutes
	TotalVolume     float64   `json:"total_volume"`
	PositiveRating  int       `json:"positive_rating"`
	NegativeRating  int       `json:"negative_rating"`
	RegisteredAt    time.Time `json:"registered_at"`
	LastActiveAt   time.Time `json:"last_active_at"`
}

type PaymentMethod struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Type        string `json:"type"` // "bank", "wallet", "cash"
	Enabled     bool   `json:"enabled"`
}

type TradeDispute struct {
	ID          string    `json:"id"`
	OrderID     string    `json:"order_id"`
	OpenedBy    string    `json:"opened_by"`
	Reason      string    `json:"reason"`
	Description string    `json:"description"`
	Status      string    `json:"status"` // "open", "under_review", "resolved", "closed"
	Resolution  string    `json:"resolution"`
	ResolvedBy  string    `json:"resolved_by"`
	CreatedAt   time.Time `json:"created_at"`
	ResolvedAt  *time.Time `json:"resolved_at"`
}

type UserRating struct {
	ID          string    `json:"id"`
	OrderID     string    `json:"order_id"`
	RaterID     string    `json:"rater_id"`
	RatedUserID string    `json:"rated_user_id"`
	Rating      int       `json:"rating"` // 1-5
	Comment     string    `json:"comment"`
	CreatedAt   time.Time `json:"created_at"`
}

// =============================================================================
// P2P SERVICE
// =============================================================================

type P2PService struct {
	// In production, use database
	ads         map[string]*P2PAd
	orders      map[string]*P2POrder
	users       map[string]*User
	paymentMethods map[string]*PaymentMethod
	disputes    map[string]*TradeDispute
	ratings     map[string]*UserRating

	mu sync.RWMutex
}

func NewP2PService() *P2PService {
	svc := &P2PService{
		ads:          make(map[string]*P2PAd),
		orders:       make(map[string]*P2POrder),
		users:        make(map[string]*User),
		paymentMethods: make(map[string]*PaymentMethod),
		disputes:     make(map[string]*TradeDispute),
		ratings:      make(map[string]*UserRating),
	}

	// Initialize payment methods
	svc.initPaymentMethods()

	return svc
}

func (s *P2PService) initPaymentMethods() {
	methods := []*PaymentMethod{
		{ID: "bank_transfer", Name: "Bank Transfer", Type: "bank", Enabled: true},
		{ID: "credit_card", Name: "Credit/Debit Card", Type: "bank", Enabled: true},
		{ID: "paypal", Name: "PayPal", Type: "wallet", Enabled: true},
		{ID: "wise", Name: "Wise", Type: "wallet", Enabled: true},
		{ID: "remitly", Name: "Remitly", Type: "wallet", Enabled: true},
		{ID: "western_union", Name: "Western Union", Type: "cash", Enabled: true},
		{ID: "moneygram", Name: "MoneyGram", Type: "cash", Enabled: true},
		{ID: "upi", Name: "UPI (India)", Type: "bank", Enabled: true},
		{ID: "pix", Name: "PIX (Brazil)", Type: "bank", Enabled: true},
		{ID: "alipay", Name: "Alipay", Type: "wallet", Enabled: true},
		{ID: "wechat", Name: "WeChat Pay", Type: "wallet", Enabled: true},
	}

	for _, m := range methods {
		s.paymentMethods[m.ID] = m
	}
}

// =============================================================================
// USER MANAGEMENT
// =============================================================================

func (s *P2PService) CreateUser(email, username, password string) (*User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Check if user exists
	for _, u := range s.users {
		if u.Email == email {
			return nil, APIError{Code: 409, Message: "Email already registered"}
		}
	}

	// Hash password
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}

	user := &User{
		ID:              uuid.New().String(),
		Email:           email,
		Username:        username,
		PasswordHash:    string(hash),
		Role:           "user",
		KYCLevel:        0,
		TradeCount:      0,
		CompletionRate:  0,
		AvgReleaseTime:  0,
		TotalVolume:     0,
		PositiveRating:  0,
		NegativeRating:  0,
		RegisteredAt:   time.Now(),
		LastActiveAt:    time.Now(),
	}

	s.users[user.ID] = user
	return user, nil
}

func (s *P2PService) GetUser(userID string) (*User, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	user, ok := s.users[userID]
	if !ok {
		return nil, APIError{Code: 404, Message: "User not found"}
	}
	return user, nil
}

func (s *P2PService) UpdateUserActivity(userID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if user, ok := s.users[userID]; ok {
		user.LastActiveAt = time.Now()
	}
	return nil
}

// =============================================================================
// AD MANAGEMENT
// =============================================================================

func (s *P2PService) CreateAd(ownerID string, ad *P2PAd) (*P2PAd, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Verify user exists
	if _, ok := s.users[ownerID]; !ok {
		return nil, APIError{Code: 404, Message: "User not found"}
	}

	// Verify payment method exists
	if _, ok := s.paymentMethods[ad.PaymentMethod]; !ok {
		return nil, APIError{Code: 400, Message: "Invalid payment method"}
	}

	// Validate ad
	if ad.MinAmount <= 0 || ad.MaxAmount <= 0 || ad.MinAmount > ad.MaxAmount {
		return nil, APIError{Code: 400, Message: "Invalid amount range"}
	}

	if ad.Type != "buy" && ad.Type != "sell" {
		return nil, APIError{Code: 400, Message: "Invalid ad type"}
	}

	ad.ID = uuid.New().String()
	ad.OwnerID = ownerID
	ad.Status = "active"
	ad.TradeCount = 0
	ad.CompletionRate = 0
	ad.CreatedAt = time.Now()
	ad.UpdatedAt = time.Now()

	s.ads[ad.ID] = ad
	return ad, nil
}

func (s *P2PService) GetAd(adID string) (*P2PAd, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	ad, ok := s.ads[adID]
	if !ok {
		return nil, APIError{Code: 404, Message: "Ad not found"}
	}
	return ad, nil
}

func (s *P2PService) GetAds(filters map[string]string) ([]*P2PAd, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*P2PAd

	for _, ad := range s.ads {
		if ad.Status != "active" {
			continue
		}

		// Apply filters
		if asset, ok := filters["asset"]; ok && ad.Asset != asset {
			continue
		}
		if fiat, ok := filters["fiat_currency"]; ok && ad.FiatCurrency != fiat {
			continue
		}
		if ptype, ok := filters["type"]; ok && ad.Type != ptype {
			continue
		}
		if method, ok := filters["payment_method"]; ok && ad.PaymentMethod != method {
			continue
		}

		result = append(result, ad)
	}

	return result, nil
}

func (s *P2PService) UpdateAdStatus(ownerID, adID, status string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	ad, ok := s.ads[adID]
	if !ok {
		return APIError{Code: 404, Message: "Ad not found"}
	}

	if ad.OwnerID != ownerID {
		return APIError{Code: 403, Message: "Not authorized"}
	}

	ad.Status = status
	ad.UpdatedAt = time.Now()
	return nil
}

// =============================================================================
// ORDER MANAGEMENT
// =============================================================================

func (s *P2PService) CreateOrder(buyerID, adID string, fiatAmount float64) (*P2POrder, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Get ad
	ad, ok := s.ads[adID]
	if !ok {
		return nil, APIError{Code: 404, Message: "Ad not found"}
	}

	if ad.Status != "active" {
		return nil, APIError{Code: 400, Message: "Ad is not active"}
	}

	if ad.OwnerID == buyerID {
		return nil, APIError{Code: 400, Message: "Cannot buy from your own ad"}
	}

	// Validate amount
	if fiatAmount < ad.MinAmount || fiatAmount > ad.MaxAmount {
		return nil, APIError{Code: 400, Message: "Amount outside allowed range"}
	}

	// Calculate crypto amount
	cryptoPrice := ad.FixedPrice
	if ad.PriceType == "float" {
		// In production, get current market price and apply margin
		cryptoPrice = 65000.0 * (1 + ad.PriceMargin/100)
	}

	cryptoAmount := fiatAmount / cryptoPrice

	order := &P2POrder{
		ID:           uuid.New().String(),
		AdID:         adID,
		BuyerID:      buyerID,
		SellerID:     ad.OwnerID,
		Asset:        ad.Asset,
		FiatAmount:   fiatAmount,
		CryptoAmount: cryptoAmount,
		CryptoPrice:  cryptoPrice,
		Status:       "pending",
		CreatedAt:    time.Now(),
	}

	s.orders[order.ID] = order
	return order, nil
}

func (s *P2PService) GetOrder(orderID string) (*P2POrder, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	order, ok := s.orders[orderID]
	if !ok {
		return nil, APIError{Code: 404, Message: "Order not found"}
	}
	return order, nil
}

func (s *P2PService) MarkOrderPaid(orderID, userID, proof string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	order, ok := s.orders[orderID]
	if !ok {
		return APIError{Code: 404, Message: "Order not found"}
	}

	// Only buyer can mark as paid
	if order.BuyerID != userID {
		return APIError{Code: 403, Message: "Not authorized"}
	}

	if order.Status != "pending" {
		return APIError{Code: 400, Message: "Order is not pending"}
	}

	now := time.Now()
	order.Status = "paid"
	order.PaymentProof = proof
	order.PaidAt = &now

	return nil
}

func (s *P2PService) ReleaseOrder(orderID, userID, txHash string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	order, ok := s.orders[orderID]
	if !ok {
		return APIError{Code: 404, Message: "Order not found"}
	}

	// Only seller can release
	if order.SellerID != userID {
		return APIError{Code: 403, Message: "Not authorized"}
	}

	if order.Status != "paid" {
		return APIError{Code: 400, Message: "Order has not been paid"}
	}

	now := time.Now()
	order.Status = "released"
	order.ReleaseTxHash = txHash
	order.ReleasedAt = &now

	// Update trade counts and completion rates
	if ad, ok := s.ads[order.AdID]; ok {
		ad.TradeCount++
		// Update completion rate
	}

	return nil
}

func (s *P2PService) CancelOrder(orderID, userID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	order, ok := s.orders[orderID]
	if !ok {
		return APIError{Code: 404, Message: "Order not found"}
	}

	if order.BuyerID != userID && order.SellerID != userID {
		return APIError{Code: 403, Message: "Not authorized"}
	}

	if order.Status != "pending" {
		return APIError{Code: 400, Message: "Can only cancel pending orders"}
	}

	order.Status = "cancelled"
	return nil
}

// =============================================================================
// DISPUTE MANAGEMENT
// =============================================================================

func (s *P2PService) OpenDispute(orderID, userID, reason, description string) (*TradeDispute, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	order, ok := s.orders[orderID]
	if !ok {
		return nil, APIError{Code: 404, Message: "Order not found"}
	}

	// Only buyer or seller can open dispute
	if order.BuyerID != userID && order.SellerID != userID {
		return nil, APIError{Code: 403, Message: "Not authorized"}
	}

	dispute := &TradeDispute{
		ID:          uuid.New().String(),
		OrderID:     orderID,
		OpenedBy:    userID,
		Reason:      reason,
		Description: description,
		Status:      "open",
		CreatedAt:   time.Now(),
	}

	order.Status = "disputed"
	s.disputes[dispute.ID] = dispute
	return dispute, nil
}

func (s *P2PService) ResolveDispute(disputeID, adminID, resolution string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	dispute, ok := s.disputes[disputeID]
	if !ok {
		return APIError{Code: 404, Message: "Dispute not found"}
	}

	dispute.Status = "resolved"
	dispute.Resolution = resolution
	dispute.ResolvedBy = adminID

	now := time.Now()
	dispute.ResolvedAt = &now

	// Update order status based on resolution
	if order, ok := s.orders[dispute.OrderID]; ok {
		if resolution == "release" {
			order.Status = "released"
		} else if resolution == "cancel" {
			order.Status = "cancelled"
		}
	}

	return nil
}

// =============================================================================
// RATINGS
// =============================================================================

func (s *P2PService) CreateRating(raterID, orderID string, rating int, comment string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	order, ok := s.orders[orderID]
	if !ok {
		return APIError{Code: 404, Message: "Order not found"}
	}

	// Determine rated user
	var ratedUserID string
	if raterID == order.BuyerID {
		ratedUserID = order.SellerID
	} else if raterID == order.SellerID {
		ratedUserID = order.BuyerID
	} else {
		return APIError{Code: 403, Message: "Not authorized"}
	}

	if rating < 1 || rating > 5 {
		return APIError{Code: 400, Message: "Rating must be between 1 and 5"}
	}

	ratingRec := &UserRating{
		ID:          uuid.New().String(),
		OrderID:     orderID,
		RaterID:     raterID,
		RatedUserID: ratedUserID,
		Rating:      rating,
		Comment:     comment,
		CreatedAt:   time.Now(),
	}

	s.ratings[ratingRec.ID] = ratingRec

	// Update user ratings
	if user, ok := s.users[ratedUserID]; ok {
		if rating >= 4 {
			user.PositiveRating++
		} else {
			user.NegativeRating++
		}
	}

	return nil
}

// =============================================================================
// PAYMENT METHODS
// =============================================================================

func (s *P2PService) GetPaymentMethods() []*PaymentMethod {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*PaymentMethod
	for _, m := range s.paymentMethods {
		result = append(result, m)
	}
	return result
}

// =============================================================================
// HTTP HANDLERS
// =============================================================================

func (s *P2PService) RegisterUser(c *gin.Context) {
	var req struct {
		Email    string `json:"email" binding:"required,email"`
		Username string `json:"username" binding:"required"`
		Password string `json:"password" binding:"required,min=8"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	user, err := s.CreateUser(req.Email, req.Username, req.Password)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"success": false, "error": gin.H{"code": 409, "message": err.Error()}})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"success": true, "data": user})
}

func (s *P2PService) CreateAdHandler(c *gin.Context) {
	var req struct {
		OwnerID       string  `json:"owner_id" binding:"required"`
		Type          string  `json:"type" binding:"required,oneof=buy sell"`
		Asset         string  `json:"asset" binding:"required"`
		FiatCurrency  string  `json:"fiat_currency" binding:"required"`
		PriceType     string  `json:"price_type" binding:"required,oneof=fixed float"`
		PriceMargin   float64 `json:"price_margin"`
		FixedPrice    float64 `json:"fixed_price"`
		MinAmount     float64 `json:"min_amount" binding:"required,gt=0"`
		MaxAmount     float64 `json:"max_amount" binding:"required,gt=0"`
		PaymentMethod string  `json:"payment_method" binding:"required"`
		Terms         string  `json:"terms"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	ad := &P2PAd{
		Type:          req.Type,
		Asset:         req.Asset,
		FiatCurrency:  req.FiatCurrency,
		PriceType:     req.PriceType,
		PriceMargin:   req.PriceMargin,
		FixedPrice:    req.FixedPrice,
		MinAmount:     req.MinAmount,
		MaxAmount:     req.MaxAmount,
		PaymentMethod: req.PaymentMethod,
		Terms:         req.Terms,
	}

	result, err := s.CreateAd(req.OwnerID, ad)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"success": true, "data": result})
}

func (s *P2PService) GetAdsHandler(c *gin.Context) {
	filters := make(map[string]string)

	if asset := c.Query("asset"); asset != "" {
		filters["asset"] = asset
	}
	if fiat := c.Query("fiat_currency"); fiat != "" {
		filters["fiat_currency"] = fiat
	}
	if ptype := c.Query("type"); ptype != "" {
		filters["type"] = ptype
	}
	if method := c.Query("payment_method"); method != "" {
		filters["payment_method"] = method
	}

	ads, err := s.GetAds(filters)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": ads})
}

func (s *P2PService) CreateOrderHandler(c *gin.Context) {
	var req struct {
		BuyerID    string  `json:"buyer_id" binding:"required"`
		AdID       string  `json:"ad_id" binding:"required"`
		FiatAmount float64 `json:"fiat_amount" binding:"required,gt=0"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	order, err := s.CreateOrder(req.BuyerID, req.AdID, req.FiatAmount)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"success": true, "data": order})
}

func (s *P2PService) MarkOrderPaidHandler(c *gin.Context) {
	orderID := c.Param("id")

	var req struct {
		UserID       string `json:"user_id" binding:"required"`
		PaymentProof string `json:"payment_proof" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	if err := s.MarkOrderPaid(orderID, req.UserID, req.PaymentProof); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (s *P2PService) ReleaseOrderHandler(c *gin.Context) {
	orderID := c.Param("id")

	var req struct {
		UserID      string `json:"user_id" binding:"required"`
		TxHash      string `json:"tx_hash" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	if err := s.ReleaseOrder(orderID, req.UserID, req.TxHash); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (s *P2PService) OpenDisputeHandler(c *gin.Context) {
	var req struct {
		UserID      string `json:"user_id" binding:"required"`
		OrderID     string `json:"order_id" binding:"required"`
		Reason      string `json:"reason" binding:"required"`
		Description string `json:"description" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	dispute, err := s.OpenDispute(req.OrderID, req.UserID, req.Reason, req.Description)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"success": true, "data": dispute})
}

func (s *P2PService) GetPaymentMethodsHandler(c *gin.Context) {
	methods := s.GetPaymentMethods()
	c.JSON(http.StatusOK, gin.H{"success": true, "data": methods})
}

func (s *P2PService) HealthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":    "healthy",
		"service":   "p2p-service",
		"timestamp": time.Now().Format(time.RFC3339),
	})
}

// =============================================================================
// MAIN
// =============================================================================

func main() {
	// Set Gin to release mode
	gin.SetMode(gin.ReleaseMode)

	// Create service
	p2pService := NewP2PService()

	// Create demo users
	p2pService.CreateUser("seller@example.com", "SellerPro", "password123")
	p2pService.CreateUser("buyer@example.com", "BuyerPro", "password123")

	// Create demo ads
	p2pService.CreateAd("seller1", &P2PAd{
		Type:          "sell",
		Asset:         "USDT",
		FiatCurrency:  "USD",
		PriceType:     "fixed",
		FixedPrice:    1.01,
		MinAmount:     100,
		MaxAmount:     5000,
		PaymentMethod: "bank_transfer",
		Terms:         "Fast release, minimum 100 USD",
	})

	p2pService.CreateAd("seller2", &P2PAd{
		Type:          "buy",
		Asset:         "USDT",
		FiatCurrency:  "EUR",
		PriceType:     "float",
		PriceMargin:   -2,
		MinAmount:     50,
		MaxAmount:     3000,
		PaymentMethod: "sepa",
		Terms:         "Instant payment via SEPA",
	})

	// Setup router
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
	r.GET("/health", p2pService.HealthCheck)

	// API routes
	api := r.Group("/api/v1/p2p")
	{
		// Users
		api.POST("/users", p2pService.RegisterUser)

		// Ads
		api.POST("/ads", p2pService.CreateAdHandler)
		api.GET("/ads", p2pService.GetAdsHandler)
		api.GET("/ads/:id", func(c *gin.Context) {
			ad, err := p2pService.GetAd(c.Param("id"))
			if err != nil {
				c.JSON(http.StatusNotFound, gin.H{"success": false, "error": gin.H{"code": 404, "message": err.Error()}})
				return
			}
			c.JSON(http.StatusOK, gin.H{"success": true, "data": ad})
		})

		// Orders
		api.POST("/orders", p2pService.CreateOrderHandler)
		api.GET("/orders/:id", func(c *gin.Context) {
			order, err := p2pService.GetOrder(c.Param("id"))
			if err != nil {
				c.JSON(http.StatusNotFound, gin.H{"success": false, "error": gin.H{"code": 404, "message": err.Error()}})
				return
			}
			c.JSON(http.StatusOK, gin.H{"success": true, "data": order})
		})
		api.POST("/orders/:id/paid", p2pService.MarkOrderPaidHandler)
		api.POST("/orders/:id/release", p2pService.ReleaseOrderHandler)
		api.POST("/orders/:id/cancel", func(c *gin.Context) {
			orderID := c.Param("id")
			var req struct {
				UserID string `json:"user_id" binding:"required"`
			}
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"success": false})
				return
			}
			if err := p2pService.CancelOrder(orderID, req.UserID); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"message": err.Error()}})
				return
			}
			c.JSON(http.StatusOK, gin.H{"success": true})
		})

		// Disputes
		api.POST("/disputes", p2pService.OpenDisputeHandler)

		// Payment methods
		api.GET("/payment-methods", p2pService.GetPaymentMethodsHandler)
	}

	fmt.Println("Starting P2P Service on :8086")
	r.Run(":8086")
}
