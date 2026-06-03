// =============================================================================
// COMPREHENSIVE P2P TRADING SYSTEM
// Complete peer-to-peer fiat-crypto trading platform
// =============================================================================

package p2p

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// ============================================================================
// CONSTANTS
// ============================================================================

const (
	StatusCreated = "created"
	StatusOpen = "open"
	StatusPending = "pending"
	StatusCompleted = "completed"
	StatusCancelled = "cancelled"
	StatusDisputed = "disputed"
	StatusExpired = "expired"
	
	TradeTypeBuy = "buy"  // User buying crypto (selling fiat)
	TradeTypeSell = "sell" // User selling crypto (buying fiat)
	
	MethodBankTransfer = "bank_transfer"
	MethodSEPA = "sepa"
	MethodSwift = "swift"
	MethodPayPal = "paypal"
	MethodWesternUnion = "western_union"
	MethodGiftCard = "gift_card"
	MethodCash = "cash"
)

// ============================================================================
// TYPES
// ============================================================================

type Config struct {
	PlatformFeePercent float64
	MinTradeAmount float64
	MaxTradeAmount float64
	DisputeWindow time.Duration
	AutoCancelTime time.Duration
	MaxDisputes int
}

type P2PAd struct {
	ID string
	UserID string
	Type string // "buy" or "sell"
	Asset string // "BTC", "ETH", "USDT"
	FiatCurrency string // "USD", "EUR", "GBP"
	PaymentMethod string
	PriceType string // "fixed" or "float"
	PriceMargin float64 // Percentage above/below market
	FixedPrice float64
	MinAmount float64
	MaxAmount float64
	Terms string
	Status string
	OrdersCount int
	CompletedOrders int
	Rating float64
	TotalRatings int
	CreatedAt time.Time
	UpdatedAt time.Time
	
	mu sync.RWMutex
}

type P2POrder struct {
	ID string
	AdID string
	AdType string
	UserID string
	CounterpartyID string
	Asset string
	FiatCurrency string
	Amount float64 // Crypto amount
	FiatAmount float64 // Fiat amount
	Rate float64
	PaymentMethod string
	Status string
	EscrowAddress string
	ReleaseSecret string
	HashLock string
	DisputeID string
	CompletedAt *time.Time
	CreatedAt time.Time
	UpdatedAt time.Time
	
	mu sync.RWMutex
}

type ChatMessage struct {
	ID string
	OrderID string
	SenderID string
	Message string
	Timestamp time.Time
}

type Dispute struct {
	ID string
	OrderID string
	ReporterID string
	ReportedUserID string
	Reason string
	Description string
	Status string // "open", "investigating", "resolved", "closed"
	Resolution string
	WinnerID string
	CreatedAt time.Time
	ResolvedAt *time.Time
	
	mu sync.RWMutex
}

type UserReputation struct {
	UserID string
	TotalTrades int
	CompletedTrades int
	CancelledTrades int
	DisputesOpened int
	DisputesLost int
	Rating float64
	TotalRatings int
	PositiveFeedback int
	NegativeFeedback int
	MemberSince time.Time
	LastActive time.Time
	
	mu sync.RWMutex
}

type P2PManager struct {
	mu sync.RWMutex
	config Config
	ads map[string]*P2PAd
	orders map[string]*P2POrder
	disputes map[string]*Dispute
	chats map[string][]ChatMessage
	reputation map[string]*UserReputation
	userAds map[string]map[string]*P2PAd // userID -> adID -> ad
	orderChats map[string][]*ChatMessage // orderID -> messages
	
	escrow EscrowService
	
	status string
	startTime time.Time
}

type EscrowService interface {
	CreateEscrow(orderID, buyer, seller, asset string, amount float64) (string, error)
	ReleaseFunds(orderID, recipient string) error
	Refund(orderID, recipient string) error
	GetEscrowStatus(escrowID string) (string, error)
}

type PaymentMethod struct {
	ID string
	Name string
	Type string
	IconURL string
	ProcessingTime string
	RequiresVerification bool
}

// ============================================================================
// CONSTRUCTOR
// ============================================================================

func NewP2PManager(cfg Config) *P2PManager {
	if cfg.PlatformFeePercent <= 0 {
		cfg.PlatformFeePercent = 0.5 // 0.5%
	}
	if cfg.MinTradeAmount <= 0 {
		cfg.MinTradeAmount = 10
	}
	if cfg.MaxTradeAmount <= 0 {
		cfg.MaxTradeAmount = 10000
	}
	if cfg.DisputeWindow <= 0 {
		cfg.DisputeWindow = 24 * time.Hour
	}
	if cfg.AutoCancelTime <= 0 {
		cfg.AutoCancelTime = 30 * time.Minute
	}
	
	return &P2PManager{
		config: cfg,
		ads: make(map[string]*P2PAd),
		orders: make(map[string]*P2POrder),
		disputes: make(map[string]*Dispute),
		chats: make(map[string][]ChatMessage),
		reputation: make(map[string]*UserReputation),
		userAds: make(map[string]map[string]*P2PAd),
		orderChats: make(map[string][]*ChatMessage),
		status: "active",
		startTime: time.Now(),
	}
}

// ============================================================================
// AD MANAGEMENT
// ============================================================================

func (m *P2PManager) CreateAd(ctx context.Context, userID string, req *CreateAdRequest) (*P2PAd, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	// Validate asset and currency
	if req.Asset == "" || req.FiatCurrency == "" {
		return nil, fmt.Errorf("asset and currency required")
	}
	
	// Get current market price (would integrate with price feed)
	marketPrice := m.getMarketPrice(req.Asset)
	
	// Calculate price
	var price float64
	if req.PriceType == "fixed" {
		price = req.FixedPrice
	} else {
		price = marketPrice * (1 + req.PriceMargin/100)
	}
	
	ad := &P2PAd{
		ID: generateAdID(),
		UserID: userID,
		Type: req.Type,
		Asset: req.Asset,
		FiatCurrency: req.FiatCurrency,
		PaymentMethod: req.PaymentMethod,
		PriceType: req.PriceType,
		PriceMargin: req.PriceMargin,
		FixedPrice: price,
		MinAmount: req.MinAmount,
		MaxAmount: req.MaxAmount,
		Terms: req.Terms,
		Status: StatusOpen,
		OrdersCount: 0,
		CompletedOrders: 0,
		Rating: 0,
		TotalRatings: 0,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	
	m.ads[ad.ID] = ad
	
	// Track user's ads
	if m.userAds[userID] == nil {
		m.userAds[userID] = make(map[string]*P2PAd)
	}
	m.userAds[userID][ad.ID] = ad
	
	return ad, nil
}

func (m *P2PManager) UpdateAd(ctx context.Context, adID, userID string, req *UpdateAdRequest) (*P2PAd, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	ad, ok := m.ads[adID]
	if !ok {
		return nil, fmt.Errorf("ad not found")
	}
	
	if ad.UserID != userID {
		return nil, fmt.Errorf("not authorized")
	}
	
	if req.PriceMargin != 0 {
		ad.PriceMargin = req.PriceMargin
		marketPrice := m.getMarketPrice(ad.Asset)
		ad.FixedPrice = marketPrice * (1 + req.PriceMargin/100)
	}
	
	if req.MinAmount > 0 {
		ad.MinAmount = req.MinAmount
	}
	
	if req.MaxAmount > 0 {
		ad.MaxAmount = req.MaxAmount
	}
	
	if req.Terms != "" {
		ad.Terms = req.Terms
	}
	
	ad.UpdatedAt = time.Now()
	
	return ad, nil
}

func (m *P2PManager) PauseAd(ctx context.Context, adID, userID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	ad, ok := m.ads[adID]
	if !ok {
		return fmt.Errorf("ad not found")
	}
	
	if ad.UserID != userID {
		return fmt.Errorf("not authorized")
	}
	
	ad.Status = "paused"
	ad.UpdatedAt = time.Now()
	
	return nil
}

func (m *P2PManager) DeleteAd(ctx context.Context, adID, userID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	ad, ok := m.ads[adID]
	if !ok {
		return fmt.Errorf("ad not found")
	}
	
	if ad.UserID != userID {
		return fmt.Errorf("not authorized")
	}
	
	if ad.OrdersCount > 0 {
		return fmt.Errorf("cannot delete ad with active orders")
	}
	
	ad.Status = "deleted"
	delete(m.userAds[userID], adID)
	
	return nil
}

func (m *P2PManager) GetAd(ctx context.Context, adID string) (*P2PAd, error) {
	m.mu.RLock()
	defer m.mu.RLock()
	
	ad, ok := m.ads[adID]
	if !ok {
		return nil, fmt.Errorf("ad not found")
	}
	
	return ad, nil
}

func (m *P2PManager) SearchAds(ctx context.Context, req *SearchAdsRequest) ([]*P2PAd, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	results := make([]*P2PAd, 0)
	
	for _, ad := range m.ads {
		if ad.Status != StatusOpen {
			continue
		}
		
		if req.Type != "" && ad.Type != req.Type {
			continue
		}
		
		if req.Asset != "" && ad.Asset != req.Asset {
			continue
		}
		
		if req.FiatCurrency != "" && ad.FiatCurrency != req.FiatCurrency {
			continue
		}
		
		if req.PaymentMethod != "" && ad.PaymentMethod != req.PaymentMethod {
			continue
		}
		
		if req.MinAmount > 0 && ad.MaxAmount < req.MinAmount {
			continue
		}
		
		if req.MaxAmount > 0 && ad.MinAmount > req.MaxAmount {
			continue
		}
		
		results = append(results, ad)
	}
	
	// Sort by rating
	sortByRating(results)
	
	// Pagination
	start := 0
	if req.Offset > 0 && req.Offset < len(results) {
		start = req.Offset
	}
	
	end := start + req.Limit
	if end > len(results) {
		end = len(results)
	}
	
	if start >= len(results) {
		return []*P2PAd{}, nil
	}
	
	return results[start:end], nil
}

func (m *P2PManager) GetUserAds(ctx context.Context, userID string) ([]*P2PAd, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	ads, ok := m.userAds[userID]
	if !ok {
		return []*P2PAd{}, nil
	}
	
	result := make([]*P2PAd, 0, len(ads))
	for _, ad := range ads {
		result = append(result, ad)
	}
	
	return result, nil
}

// ============================================================================
// ORDER MANAGEMENT
// ============================================================================

func (m *P2PManager) CreateOrder(ctx context.Context, userID, adID string, amount float64) (*P2POrder, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	// Get ad
	ad, ok := m.ads[adID]
	if !ok {
		return nil, fmt.Errorf("ad not found")
	}
	
	if ad.Status != StatusOpen {
		return nil, fmt.Errorf("ad not available")
	}
	
	// Validate amount
	if amount < ad.MinAmount || amount > ad.MaxAmount {
		return nil, fmt.Errorf("amount outside ad limits: min %.2f, max %.2f", ad.MinAmount, ad.MaxAmount)
	}
	
	// Can't trade with yourself
	if ad.UserID == userID {
		return nil, fmt.Errorf("cannot trade with yourself")
	}
	
	// Calculate fiat amount
	fiatAmount := amount * ad.FixedPrice
	
	// Create order
	order := &P2POrder{
		ID: generateOrderID(),
		AdID: adID,
		AdType: ad.Type,
		UserID: userID,
		CounterpartyID: ad.UserID,
		Asset: ad.Asset,
		FiatCurrency: ad.FiatCurrency,
		Amount: amount,
		FiatAmount: fiatAmount,
		Rate: ad.FixedPrice,
		PaymentMethod: ad.PaymentMethod,
		Status: StatusPending,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	
	// If buying crypto (ad.Type = "sell"), user is buyer
	// If selling crypto (ad.Type = "buy"), user is seller
	if ad.Type == "sell" {
		order.UserID = userID // buyer
		order.CounterpartyID = ad.UserID // seller
	} else {
		order.UserID = ad.UserID // seller
		order.CounterpartyID = userID // buyer
	}
	
	m.orders[order.ID] = order
	
	// Update ad stats
	ad.OrdersCount++
	ad.UpdatedAt = time.Now()
	
	// Initialize chat for this order
	m.orderChats[order.ID] = make([]*ChatMessage, 0)
	
	return order, nil
}

func (m *P2PManager) ConfirmOrder(ctx context.Context, orderID, userID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	order, ok := m.orders[orderID]
	if !ok {
		return fmt.Errorf("order not found")
	}
	
	if order.UserID != userID && order.CounterpartyID != userID {
		return fmt.Errorf("not authorized")
	}
	
	if order.Status != StatusPending {
		return fmt.Errorf("order cannot be confirmed in current status: %s", order.Status)
	}
	
	order.Status = StatusOpen
	order.UpdatedAt = time.Now()
	
	return nil
}

func (m *P2PManager) UploadReceipt(ctx context.Context, orderID, userID, receiptData string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	order, ok := m.orders[orderID]
	if !ok {
		return fmt.Errorf("order not found")
	}
	
	// Only the crypto SELLER (buyer of fiat) uploads receipt
	isSeller := order.CounterpartyID == userID
	if !isSeller {
		return fmt.Errorf("only seller can upload payment receipt")
	}
	
	if order.Status != StatusOpen {
		return fmt.Errorf("order not in payment stage")
	}
	
	// In real implementation, would store receipt data
	// For now, just mark as processing
	order.Status = "processing"
	order.UpdatedAt = time.Now()
	
	return nil
}

func (m *P2PManager) ReleaseCrypto(ctx context.Context, orderID, userID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	order, ok := m.orders[orderID]
	if !ok {
		return fmt.Errorf("order not found")
	}
	
	// Only the crypto SELLER can release
	if order.UserID != userID {
		return fmt.Errorf("only seller can release crypto")
	}
	
	if order.Status != "processing" {
		return fmt.Errorf("order not ready for release")
	}
	
	// Calculate fees
	platformFee := order.FiatAmount * (m.config.PlatformFeePercent / 100)
	
	// Release to buyer
	// In real implementation: m.escrow.ReleaseFunds(order.ID, order.CounterpartyID)
	
	order.Status = StatusCompleted
	now := time.Now()
	order.CompletedAt = &now
	order.UpdatedAt = time.Now()
	
	// Update ad stats
	if ad, ok := m.ads[order.AdID]; ok {
		ad.CompletedOrders++
		ad.UpdatedAt = time.Now()
	}
	
	// Update reputation
	m.updateReputation(order.UserID, true) // seller completed
	m.updateReputation(order.CounterpartyID, true) // buyer completed
	
	return nil
}

func (m *P2PManager) CancelOrder(ctx context.Context, orderID, userID, reason string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	order, ok := m.orders[orderID]
	if !ok {
		return fmt.Errorf("order not found")
	}
	
	if order.UserID != userID && order.CounterpartyID != userID {
		return fmt.Errorf("not authorized")
	}
	
	if order.Status == StatusCompleted || order.Status == StatusCancelled {
		return fmt.Errorf("order already finalized")
	}
	
	order.Status = StatusCancelled
	order.UpdatedAt = time.Now()
	
	// Update ad stats
	if ad, ok := m.ads[order.AdID]; ok {
		ad.UpdatedAt = time.Now()
	}
	
	// Update reputation - canceller gets negative
	if order.UserID == userID {
		m.updateReputation(userID, false)
	} else {
		m.updateReputation(order.CounterpartyID, false)
	}
	
	return nil
}

func (m *P2PManager) GetOrder(ctx context.Context, orderID string) (*P2POrder, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	order, ok := m.orders[orderID]
	if !ok {
		return nil, fmt.Errorf("order not found")
	}
	
	return order, nil
}

func (m *P2PManager) GetUserOrders(ctx context.Context, userID string, status string, limit int) ([]*P2POrder, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	results := make([]*P2POrder, 0)
	
	for _, order := range m.orders {
		if order.UserID != userID && order.CounterpartyID != userID {
			continue
		}
		
		if status != "" && order.Status != status {
			continue
		}
		
		results = append(results, order)
		
		if limit > 0 && len(results) >= limit {
			break
		}
	}
	
	return results, nil
}

// ============================================================================
// CHAT / MESSAGING
// ============================================================================

func (m *P2PManager) SendMessage(ctx context.Context, orderID, senderID, message string) (*ChatMessage, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	order, ok := m.orders[orderID]
	if !ok {
		return nil, fmt.Errorf("order not found")
	}
	
	// Verify sender is part of order
	if order.UserID != senderID && order.CounterpartyID != senderID {
		return nil, fmt.Errorf("not authorized")
	}
	
	msg := &ChatMessage{
		ID: generateMessageID(),
		OrderID: orderID,
		SenderID: senderID,
		Message: message,
		Timestamp: time.Now(),
	}
	
	m.orderChats[orderID] = append(m.orderChats[orderID], msg)
	
	return msg, nil
}

func (m *P2PManager) GetOrderMessages(ctx context.Context, orderID, userID string) ([]*ChatMessage, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	order, ok := m.orders[orderID]
	if !ok {
		return nil, fmt.Errorf("order not found")
	}
	
	if order.UserID != userID && order.CounterpartyID != userID {
		return nil, fmt.Errorf("not authorized")
	}
	
	return m.orderChats[orderID], nil
}

// ============================================================================
// DISPUTES
// ============================================================================

func (m *P2PManager) OpenDispute(ctx context.Context, orderID, reporterID, reason, description string) (*Dispute, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	order, ok := m.orders[orderID]
	if !ok {
		return nil, fmt.Errorf("order not found")
	}
	
	// Verify reporter is part of order
	if order.UserID != reporterID && order.CounterpartyID != reporterID {
		return nil, fmt.Errorf("not authorized")
	}
	
	// Check if dispute already exists
	if order.DisputeID != "" {
		return nil, fmt.Errorf("dispute already open")
	}
	
	// Determine reported user
	var reportedID string
	if order.UserID == reporterID {
		reportedID = order.CounterpartyID
	} else {
		reportedID = order.UserID
	}
	
	dispute := &Dispute{
		ID: generateDisputeID(),
		OrderID: orderID,
		ReporterID: reporterID,
		ReportedUserID: reportedID,
		Reason: reason,
		Description: description,
		Status: "open",
		CreatedAt: time.Now(),
	}
	
	m.disputes[dispute.ID] = dispute
	order.DisputeID = dispute.ID
	order.Status = StatusDisputed
	
	// Update reputation
	m.updateDisputeStats(reporterID, true)
	
	return dispute, nil
}

func (m *P2PManager) ResolveDispute(ctx context.Context, disputeID, resolverID string, resolution, winnerID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	dispute, ok := m.disputes[disputeID]
	if !ok {
		return fmt.Errorf("dispute not found")
	}
	
	dispute.Status = "resolved"
	dispute.Resolution = resolution
	dispute.WinnerID = winnerID
	now := time.Now()
	dispute.ResolvedAt = &now
	
	// Update order
	order, ok := m.orders[dispute.OrderID]
	if ok {
		if winnerID == order.UserID {
			// Seller wins - release crypto to seller
			order.Status = "cancelled"
		} else {
			// Buyer wins - release crypto to buyer (refund seller)
			order.Status = StatusCompleted
			now := time.Now()
			order.CompletedAt = &now
		}
		order.UpdatedAt = time.Now()
	}
	
	// Update reputation
	if winnerID == dispute.ReportedUserID {
		m.updateReputation(dispute.ReportedUserID, true)
		m.updateDisputeStats(dispute.ReportedUserID, false)
	} else {
		m.updateReputation(dispute.ReportedUserID, false)
	}
	
	return nil
}

func (m *P2PManager) GetDispute(ctx context.Context, disputeID string) (*Dispute, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	dispute, ok := m.disputes[disputeID]
	if !ok {
		return nil, fmt.Errorf("dispute not found")
	}
	
	return dispute, nil
}

// ============================================================================
// REPUTATION
// ============================================================================

func (m *P2PManager) GetUserReputation(ctx context.Context, userID string) (*UserReputation, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	rep, ok := m.reputation[userID]
	if !ok {
		// Create default reputation
		rep = &UserReputation{
			UserID: userID,
			MemberSince: time.Now(),
		}
		m.reputation[userID] = rep
	}
	
	return rep, nil
}

func (m *P2PManager) RateUser(ctx context.Context, orderID, raterID, targetID string, rating int, feedback string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	if rating < 1 || rating > 5 {
		return fmt.Errorf("rating must be 1-5")
	}
	
	// Update target's reputation
	rep, ok := m.reputation[targetID]
	if !ok {
		rep = &UserReputation{
			UserID: targetID,
			MemberSince: time.Now(),
		}
		m.reputation[targetID] = rep
	}
	
	rep.TotalRatings++
	
	if rating >= 4 {
		rep.PositiveFeedback++
	} else {
		rep.NegativeFeedback++
	}
	
	// Calculate new average
	rep.Rating = (rep.Rating*float64(rep.TotalRatings-1) + float64(rating)) / float64(rep.TotalRatings)
	rep.LastActive = time.Now()
	
	// Update ad rating
	order, ok := m.orders[orderID]
	if ok {
		if ad, ok := m.ads[order.AdID]; ok {
			ad.TotalRatings++
			ad.Rating = (ad.Rating*float64(ad.TotalRatings-1) + float64(rating)) / float64(ad.TotalRatings)
		}
	}
	
	return nil
}

func (m *P2PManager) updateReputation(userID string, completed bool) {
	rep, ok := m.reputation[userID]
	if !ok {
		rep = &UserReputation{
			UserID: userID,
			MemberSince: time.Now(),
		}
		m.reputation[userID] = rep
	}
	
	rep.TotalTrades++
	if completed {
		rep.CompletedTrades++
	} else {
		rep.CancelledTrades++
	}
	rep.LastActive = time.Now()
}

func (m *P2PManager) updateDisputeStats(userID string, opened bool) {
	rep, ok := m.reputation[userID]
	if !ok {
		rep = &UserReputation{
			UserID: userID,
			MemberSince: time.Now(),
		}
		m.reputation[userID] = rep
	}
	
	if opened {
		rep.DisputesOpened++
	} else {
		rep.DisputesLost++
	}
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

func (m *P2PManager) getMarketPrice(asset string) float64 {
	// Would fetch from price feed
	prices := map[string]float64{
		"BTC": 45000,
		"ETH": 2500,
		"USDT": 1,
		"USDC": 1,
		"SOL": 100,
	}
	
	if price, ok := prices[asset]; ok {
		return price
	}
	return 1
}

func sortByRating(ads []*P2PAd) {
	// Simple bubble sort for rating
	for i := 0; i < len(ads); i++ {
		for j := i + 1; j < len(ads); j++ {
			if ads[j].Rating > ads[i].Rating {
				ads[i], ads[j] = ads[j], ads[i]
			}
		}
	}
}

func generateAdID() string { return fmt.Sprintf("P2PAD_%x", time.Now().UnixNano()) }
func generateOrderID() string { return fmt.Sprintf("P2P_%x", time.Now().UnixNano()) }
func generateDisputeID() string { return fmt.Sprintf("DSP_%x", time.Now().UnixNano()) }
func generateMessageID() string { return fmt.Sprintf("MSG_%x", time.Now().UnixNano()) }

// Request types
type CreateAdRequest struct {
	Type string
	Asset string
	FiatCurrency string
	PaymentMethod string
	PriceType string
	PriceMargin float64
	FixedPrice float64
	MinAmount float64
	MaxAmount float64
	Terms string
}

type UpdateAdRequest struct {
	PriceMargin float64
	MinAmount float64
	MaxAmount float64
	Terms string
}

type SearchAdsRequest struct {
	Type string
	Asset string
	FiatCurrency string
	PaymentMethod string
	MinAmount float64
	MaxAmount float64
	Limit int
	Offset int
}

var _ = fmt.Sprint

func init() {}

var (
	_ context.Context
	_ time.Time
)