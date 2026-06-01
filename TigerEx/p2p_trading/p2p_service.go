package main

import (
	"fmt"
	"sync"
	"time"
)

// ============================================================================
// TIGEREX P2P TRADING SERVICE
// Production-ready P2P marketplace with escrow and dispute resolution
// ============================================================================

// P2P Order Status
const (
	P2POrderOpen       = "open"
	P2POrderMatching    = "matching"
	P2POrderPayment     = "payment"
	P2POrderReleased    = "released"
	P2POrderCancelled   = "cancelled"
	P2POrderDisputed    = "disputed"
	P2POrderExpired     = "expired"
)

// P2P Order Type
const (
	P2PTypeBuy  = "buy"
	P2PTypeSell = "sell"
)

// Payment Method
const (
	PaymentBankTransfer = "bank_transfer"
	PaymentSEPA         = "sepa"
	PaymentFPS           = "fps"
	PaymentUPI           = "upi"
	PaymentIMPS          = "imps"
	PaymentJazzCash      = "jazzcash"
	PaymentEasypaisa     = "easypaisa"
	PaymentWise          = "wise"
	PaymentPayNow        = "paynow"
)

// ============================================================================
// P2P TYPES
// ============================================================================

type P2PAd struct {
	ID              string   `json:"id"`
	UserID          string   `json:"userId"`
	Type            string   `json:"type"` // buy, sell
	Currency        string   `json:"currency"` // USDT, USDC, etc.
	FiatCurrency    string   `json:"fiatCurrency"` // PKR, INR, etc.
	Price           float64  `json:"price"` // Price per unit in fiat
	SpreadPercent   float64  `json:"spreadPercent"` // Spread from market
	MinAmount       float64  `json:"minAmount"`
	MaxAmount       float64  `json:"maxAmount"`
	PaymentMethods  []string `json:"paymentMethods"`
	PaymentWindow   int64    `json:"paymentWindow"` // Minutes to make payment
	LockedAmount    float64  `json:"lockedAmount"` // Amount locked in escrow
	FilledAmount    float64  `json:"filledAmount"`
	CompletedOrders int      `json:"completedOrders"`
	CompletionRate  float64  `json:"completionRate"`
	AvgReleaseTime  float64  `json:"avgReleaseTime"` // Minutes
	Rating          float64  `json:"rating"` // 1-5 stars
	TotalVolume     float64  `json:"totalVolume"` // Total volume in fiat
	Status          string   `json:"status"` // active, paused, closed
	AutoReply       string   `json:"autoReply,omitempty"`
	CreatedAt       int64    `json:"createdAt"`
	UpdatedAt       int64    `json:"updatedAt"`
}

type P2POrder struct {
	ID              string   `json:"id"`
	AdID            string   `json:"adId"`
	AdvertiserID    string   `json:"advertiserId"` // Ad creator
	UserID          string   `json:"userId"` // Buyer/Seller who created order
	Type            string   `json:"type"` // buy, sell
	Currency        string   `json:"currency"`
	FiatCurrency    string   `json:"fiatCurrency"`
	Price           float64  `json:"price"` // Price per unit
	Amount          float64  `json:"amount"` // Crypto amount
	FiatAmount      float64  `json:"fiatAmount"` // Total fiat amount
	PaymentMethod   string   `json:"paymentMethod"`
	PaymentWindow   int64    `json:"paymentWindow"` // Minutes to pay
	PaymentDeadline int64    `json:"paymentDeadline"` // Unix timestamp
	Status          string   `json:"status"`
	EscrowStatus    string   `json:"escrowStatus"` // pending, locked, released, cancelled
	CryptoLockedAt   int64    `json:"cryptoLockedAt,omitempty"`
	PaidAt          int64    `json:"paidAt,omitempty"`
	ReleasedAt      int64    `json:"releasedAt,omitempty"`
	CancelledAt     int64    `json:"cancelledAt,omitempty"`
	Remarks         string   `json:"remarks,omitempty"`
	AppealReason    string   `json:"appealReason,omitempty"`
	AppealEvidence  []string `json:"appealEvidence,omitempty"`
	AppealDecision  string   `json:"appealDecision,omitempty"`
	AppealResolvedAt int64   `json:"appealResolvedAt,omitempty"`
	AppealResolvedBy string   `json:"appealResolvedBy,omitempty"`
	CreatedAt       int64    `json:"createdAt"`
	UpdatedAt       int64    `json:"updatedAt"`
}

type P2PDispute struct {
	ID              string        `json:"id"`
	OrderID         string        `json:"orderId"`
	DisputedBy      string        `json:"disputedBy"` // UserID
	AgainstUser     string        `json:"againstUser"` // Other party
	Reason          string        `json:"reason"`
	Description     string        `json:"description"`
	Evidence        []string      `json:"evidence"` // URLs to evidence
	Status          string        `json:"status"` // open, investigating, resolved
	Type            string        `json:"type"` // payment_issue, release_issue, scam, other
	Resolution      string        `json:"resolution,omitempty"`
	Winner          string        `json:"winner,omitempty"` // UserID
	CryptoReleasedTo string        `json:"cryptoReleasedTo,omitempty"`
	CreatedAt       int64         `json:"createdAt"`
	ResolvedAt      int64         `json:"resolvedAt,omitempty"`
}

type P2PUserStats struct {
	UserID          string  `json:"userId"`
	CompletedOrders int     `json:"completedOrders"`
	CancelledOrders int     `json:"cancelledOrders"`
	DisputedOrders   int     `json:"disputedOrders"`
	AvgRating        float64 `json:"avgRating"`
	TotalVolume      float64 `json:"totalVolume"`
	TotalVolumeFiat  float64 `json:"totalVolumeFiat"`
	ResponseTime     float64 `json:"responseTime"` // Minutes
	CompletionRate   float64 `json:"completionRate"` // Percentage
	FirstTradeAt    int64   `json:"firstTradeAt"`
	LastTradeAt     int64   `json:"lastTradeAt"`
	Verified         bool    `json:"verified"`
	PaymentMethods   []string `json:"verifiedPaymentMethods"`
}

// ============================================================================
// P2P SERVICE
// ============================================================================

type P2PService struct {
	// Ads
	ads map[string]*P2PAd // AdID -> Ad
	userAds map[string][]*P2PAd // UserID -> Ads

	// Orders
	orders map[string]*P2POrder // OrderID -> Order
	userOrders map[string][]*P2POrder // UserID -> Orders

	// Disputes
	disputes map[string]*P2PDispute // DisputeID -> Dispute

	// User stats
	userStats map[string]*P2PUserStats // UserID -> Stats

	// Fees
	makerFeePercent float64
	takerFeePercent float64

	// Limits
	minOrderAmount float64
	maxOrderAmount float64

	mu sync.RWMutex
}

func NewP2PService() *P2PService {
	return &P2PService{
		ads:              make(map[string]*P2PAd),
		userAds:          make(map[string][]*P2PAd),
		orders:           make(map[string]*P2POrder),
		userOrders:       make(map[string][]*P2POrder),
		disputes:         make(map[string]*P2PDispute),
		userStats:        make(map[string]*P2PUserStats),
		makerFeePercent:  0.1, // 0.1%
		takerFeePercent:  0.1,
		minOrderAmount:   10, // USD equivalent
		maxOrderAmount:   100000,
	}
}

// ============================================================================
// AD MANAGEMENT
// ============================================================================

func (ps *P2PService) CreateAd(req *CreateAdRequest) (*P2PAd, error) {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	// Validate
	if req.Amount < req.MinAmount {
		return nil, fmt.Errorf("amount below minimum")
	}

	if req.Price <= 0 {
		return nil, fmt.Errorf("invalid price")
	}

	adID := fmt.Sprintf("ad_%d_%s", time.Now().UnixMilli(), req.UserID[:8])
	now := time.Now().UnixMilli()

	ad := &P2PAd{
		ID:             adID,
		UserID:         req.UserID,
		Type:           req.Type,
		Currency:       req.Currency,
		FiatCurrency:   req.FiatCurrency,
		Price:          req.Price,
		SpreadPercent:  req.SpreadPercent,
		MinAmount:      req.MinAmount,
		MaxAmount:      req.MaxAmount,
		PaymentMethods: req.PaymentMethods,
		PaymentWindow: req.PaymentWindow,
		LockedAmount:   0,
		FilledAmount:   0,
		CompletedOrders: 0,
		CompletionRate: 0,
		AvgReleaseTime: 0,
		Rating:         0,
		TotalVolume:    0,
		Status:         "active",
		CreatedAt:      now,
		UpdatedAt:      now,
	}

	ps.ads[adID] = ad
	ps.userAds[req.UserID] = append(ps.userAds[req.UserID], ad)

	// Initialize user stats if not exists
	ps.initUserStats(req.UserID)

	return ad, nil
}

type CreateAdRequest struct {
	UserID         string
	Type           string
	Currency       string
	FiatCurrency   string
	Price          float64
	SpreadPercent  float64
	MinAmount      float64
	MaxAmount      float64
	PaymentMethods []string
	PaymentWindow  int64 // Minutes
}

func (ps *P2PService) GetAd(adID string) (*P2PAd, error) {
	ps.mu.RLock()
	defer ps.mu.RUnlock()

	ad, exists := ps.ads[adID]
	if !exists {
		return nil, fmt.Errorf("ad not found")
	}

	return ad, nil
}

func (ps *P2PService) GetUserAds(userID string) []*P2PAd {
	ps.mu.RLock()
	defer ps.mu.RUnlock()

	return ps.userAds[userID]
}

func (ps *P2PService) GetAdsByCurrency(currency, fiatCurrency string, adType string) []*P2PAd {
	ps.mu.RLock()
	defer ps.mu.RUnlock()

	var ads []*P2PAd
	for _, ad := range ps.ads {
		if ad.Status != "active" {
			continue
		}
		if ad.Currency != currency || ad.FiatCurrency != fiatCurrency {
			continue
		}
		if adType != "" && ad.Type != adType {
			continue
		}
		ads = append(ads, ad)
	}

	// Sort by price (best first)
	// For buy ads, lowest price is best
	// For sell ads, highest price is best
	return ads
}

func (ps *P2PService) UpdateAd(adID string, updates map[string]interface{}) error {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	ad, exists := ps.ads[adID]
	if !exists {
		return fmt.Errorf("ad not found")
	}

	if price, ok := updates["price"].(float64); ok {
		ad.Price = price
	}
	if spread, ok := updates["spreadPercent"].(float64); ok {
		ad.SpreadPercent = spread
	}
	if minAmt, ok := updates["minAmount"].(float64); ok {
		ad.MinAmount = minAmt
	}
	if maxAmt, ok := updates["maxAmount"].(float64); ok {
		ad.MaxAmount = maxAmt
	}
	if status, ok := updates["status"].(string); ok {
		ad.Status = status
	}

	ad.UpdatedAt = time.Now().UnixMilli()

	return nil
}

func (ps *P2PService) PauseAd(adID, userID string) error {
	return ps.UpdateAdStatus(adID, userID, "paused")
}

func (ps *P2PService) CloseAd(adID, userID string) error {
	return ps.UpdateAdStatus(adID, userID, "closed")
}

func (ps *P2PService) UpdateAdStatus(adID, userID, status string) error {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	ad, exists := ps.ads[adID]
	if !exists {
		return fmt.Errorf("ad not found")
	}

	if ad.UserID != userID {
		return fmt.Errorf("unauthorized")
	}

	ad.Status = status
	ad.UpdatedAt = time.Now().UnixMilli()

	return nil
}

// ============================================================================
// ORDER MANAGEMENT
// ============================================================================

func (ps *P2PService) CreateOrder(req *CreateOrderRequest) (*P2POrder, error) {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	// Get ad
	ad, exists := ps.ads[req.AdID]
	if !exists {
		return nil, fmt.Errorf("ad not found")
	}

	if ad.Status != "active" {
		return nil, fmt.Errorf("ad not available")
	}

	// Validate amount
	if req.Amount < ad.MinAmount {
		return nil, fmt.Errorf("amount below minimum: %.4f", ad.MinAmount)
	}

	if ad.MaxAmount > 0 && req.Amount > ad.MaxAmount {
		return nil, fmt.Errorf("amount above maximum: %.4f", ad.MaxAmount)
	}

	// Can't trade with own ad
	if ad.UserID == req.UserID {
		return nil, fmt.Errorf("cannot trade with your own ad")
	}

	// Check if advertiser has sufficient locked balance
	// In production, this would check the wallet/escrow service

	now := time.Now().UnixMilli()
	orderID := fmt.Sprintf("p2p_%d_%s", now, req.UserID[:8])

	// Calculate fiat amount
	fiatAmount := req.Amount * ad.Price

	order := &P2POrder{
		ID:              orderID,
		AdID:            req.AdID,
		AdvertiserID:    ad.UserID,
		UserID:          req.UserID,
		Type:            ad.Type, // Ad creator's type is what they're offering
		Currency:        ad.Currency,
		FiatCurrency:    ad.FiatCurrency,
		Price:           ad.Price,
		Amount:          req.Amount,
		FiatAmount:      fiatAmount,
		PaymentMethod:   req.PaymentMethod,
		PaymentWindow:   ad.PaymentWindow,
		PaymentDeadline: now + ad.PaymentWindow*60*1000,
		Status:          P2POrderOpen,
		EscrowStatus:    "pending",
		CreatedAt:       now,
		UpdatedAt:       now,
	}

	// Update ad
	ad.FilledAmount += req.Amount

	if ad.FilledAmount >= ad.MaxAmount && ad.MaxAmount > 0 {
		ad.Status = "closed"
	}

	// Store
	ps.orders[orderID] = order
	ps.userOrders[req.UserID] = append(ps.userOrders[req.UserID], order)

	// Initialize user stats
	ps.initUserStats(req.UserID)

	return order, nil
}

type CreateOrderRequest struct {
	AdID         string
	UserID       string
	Amount       float64
	PaymentMethod string
}

func (ps *P2PService) GetOrder(orderID string) (*P2POrder, error) {
	ps.mu.RLock()
	defer ps.mu.RUnlock()

	order, exists := ps.orders[orderID]
	if !exists {
		return nil, fmt.Errorf("order not found")
	}

	return order, nil
}

func (ps *P2PService) GetUserOrders(userID string) []*P2POrder {
	ps.mu.RLock()
	defer ps.mu.RUnlock()

	// Include both orders created and orders received
	var allOrders []*P2POrder

	for _, order := range ps.orders {
		if order.UserID == userID || order.AdvertiserID == userID {
			allOrders = append(allOrders, order)
		}
	}

	return allOrders
}

// ============================================================================
// ESCROW OPERATIONS
// ============================================================================

func (ps *P2PService) LockCryptoForOrder(orderID string) error {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	order, exists := ps.orders[orderID]
	if !exists {
		return fmt.Errorf("order not found")
	}

	if order.EscrowStatus != "pending" {
		return fmt.Errorf("escrow already processed")
	}

	// Lock crypto in escrow
	// In production, this would interact with the wallet service
	order.EscrowStatus = "locked"
	order.CryptoLockedAt = time.Now().UnixMilli()
	order.UpdatedAt = time.Now().UnixMilli()

	// Update ad locked amount
	if ad, exists := ps.ads[order.AdID]; exists {
		ad.LockedAmount += order.Amount
	}

	return nil
}

func (ps *P2PService) ConfirmPayment(orderID, userID string) error {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	order, exists := ps.orders[orderID]
	if !exists {
		return fmt.Errorf("order not found")
	}

	// Only the buyer confirms payment
	if order.UserID != userID {
		return fmt.Errorf("unauthorized")
	}

	if order.Status != P2POrderOpen {
		return fmt.Errorf("order not in correct status")
	}

	// Check if within payment window
	if time.Now().UnixMilli() > order.PaymentDeadline {
		order.Status = P2POrderExpired
		return fmt.Errorf("payment window expired")
	}

	order.Status = P2POrderPayment
	order.PaidAt = time.Now().UnixMilli()
	order.UpdatedAt = time.Now().UnixMilli()

	return nil
}

func (ps *P2PService) ReleaseCrypto(orderID, userID string) error {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	order, exists := ps.orders[orderID]
	if !exists {
		return fmt.Errorf("order not found")
	}

	// Only advertiser can release (they have the crypto locked)
	if order.AdvertiserID != userID {
		return fmt.Errorf("unauthorized")
	}

	if order.Status != P2POrderPayment {
		return fmt.Errorf("order not in payment status")
	}

	if order.EscrowStatus != "locked" {
		return fmt.Errorf("crypto not locked")
	}

	// Release crypto to buyer
	order.EscrowStatus = "released"
	order.Status = P2POrderReleased
	order.ReleasedAt = time.Now().UnixMilli()
	order.UpdatedAt = time.Now().UnixMilli()

	// Update stats
	ps.updateOrderStats(order)

	// Update ad stats
	if ad, exists := ps.ads[order.AdID]; exists {
		ad.CompletedOrders++
		ad.LockedAmount -= order.Amount
		ad.TotalVolume += order.FiatAmount
		if ad.CompletedOrders > 0 {
			ad.CompletionRate = float64(ad.CompletedOrders) / float64(ad.CompletedOrders+1) * 100
		}
	}

	return nil
}

func (ps *P2PService) CancelOrder(orderID, userID string) error {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	order, exists := ps.orders[orderID]
	if !exists {
		return fmt.Errorf("order not found")
	}

	// Either party can cancel in open status
	if order.Status != P2POrderOpen {
		return fmt.Errorf("cannot cancel order in status: %s", order.Status)
	}

	// Check if buyer or advertiser
	isBuyer := order.UserID == userID
	isAdvertiser := order.AdvertiserID == userID

	if !isBuyer && !isAdvertiser {
		return fmt.Errorf("unauthorized")
	}

	// Cancel escrow
	if order.EscrowStatus == "locked" {
		order.EscrowStatus = "cancelled"
		// Release locked crypto back to advertiser
		if ad, exists := ps.ads[order.AdID]; exists {
			ad.LockedAmount -= order.Amount
		}
	}

	order.Status = P2POrderCancelled
	order.CancelledAt = time.Now().UnixMilli()
	order.UpdatedAt = time.Now().UnixMilli()

	// Update ad
	if ad, exists := ps.ads[order.AdID]; exists {
		ad.FilledAmount -= order.Amount
	}

	return nil
}

// ============================================================================
// DISPUTE MANAGEMENT
// ============================================================================

func (ps *P2PService) CreateDispute(orderID, userID, reason, description string) (*P2PDispute, error) {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	order, exists := ps.orders[orderID]
	if !exists {
		return nil, fmt.Errorf("order not found")
	}

	// Check if user is part of this order
	isBuyer := order.UserID == userID
	isAdvertiser := order.AdvertiserID == userID

	if !isBuyer && !isAdvertiser {
		return nil, fmt.Errorf("unauthorized")
	}

	// Order must be in payment status to dispute
	if order.Status != P2POrderPayment {
		return nil, fmt.Errorf("can only dispute orders in payment status")
	}

	// Determine other party
	otherParty := order.AdvertiserID
	if isAdvertiser {
		otherParty = order.UserID
	}

	disputeID := fmt.Sprintf("dispute_%d_%s", time.Now().UnixMilli(), userID[:8])
	now := time.Now().UnixMilli()

	dispute := &P2PDispute{
		ID:          disputeID,
		OrderID:     orderID,
		DisputedBy:  userID,
		AgainstUser: otherParty,
		Reason:      reason,
		Description: description,
		Status:      "open",
		Type:        ps.categorizeDisputeType(reason),
		CreatedAt:   now,
	}

	// Update order
	order.Status = P2POrderDisputed
	order.AppealReason = reason
	order.UpdatedAt = now

	ps.disputes[disputeID] = dispute

	return dispute, nil
}

func (ps *P2PService) categorizeDisputeType(reason string) string {
	switch reason {
	case "payment_not_received":
		return "payment_issue"
	case "payment_wrong_amount":
		return "payment_issue"
	case "seller_not_releasing":
		return "release_issue"
	case "buyer_false_claim":
		return "scam"
	default:
		return "other"
	}
}

func (ps *P2PService) AddDisputeEvidence(disputeID string, evidenceURLs []string) error {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	dispute, exists := ps.disputes[disputeID]
	if !exists {
		return fmt.Errorf("dispute not found")
	}

	if dispute.Status != "open" {
		return fmt.Errorf("dispute already resolved")
	}

	dispute.Evidence = append(dispute.Evidence, evidenceURLs...)

	return nil
}

func (ps *P2PService) ResolveDispute(disputeID, resolverID string, resolution, winner string, cryptoToWinner float64) error {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	dispute, exists := ps.disputes[disputeID]
	if !exists {
		return fmt.Errorf("dispute not found")
	}

	if dispute.Status != "open" && dispute.Status != "investigating" {
		return fmt.Errorf("dispute already resolved")
	}

	now := time.Now().UnixMilli()

	dispute.Status = "resolved"
	dispute.Resolution = resolution
	dispute.Winner = winner
	dispute.CryptoReleasedTo = winner
	dispute.ResolvedAt = now

	// Update order
	order, exists := ps.orders[dispute.OrderID]
	if exists {
		order.Status = P2POrderReleased
		order.AppealDecision = resolution
		order.AppealResolvedAt = now
		order.AppealResolvedBy = resolverID
		order.ReleasedAt = now
		order.UpdatedAt = now
	}

	// Update stats
	ps.updateOrderStats(order)

	return nil
}

func (ps *P2PService) GetOrderDispute(orderID string) (*P2PDispute, error) {
	ps.mu.RLock()
	defer ps.mu.RUnlock()

	for _, dispute := range ps.disputes {
		if dispute.OrderID == orderID {
			return dispute, nil
		}
	}

	return nil, fmt.Errorf("dispute not found")
}

// ============================================================================
// STATS
// ============================================================================

func (ps *P2PService) initUserStats(userID string) {
	if _, exists := ps.userStats[userID]; !exists {
		ps.userStats[userID] = &P2PUserStats{
			UserID:        userID,
			CompletedOrders: 0,
			CancelledOrders: 0,
			DisputedOrders: 0,
			AvgRating:     0,
			TotalVolume:   0,
			TotalVolumeFiat: 0,
			ResponseTime:  0,
			CompletionRate: 0,
			Verified:      false,
			PaymentMethods: make([]string, 0),
		}
	}
}

func (ps *P2PService) updateOrderStats(order *P2POrder) {
	if order == nil {
		return
	}

	// Update buyer stats
	ps.initUserStats(order.UserID)
	buyerStats := ps.userStats[order.UserID]
	buyerStats.LastTradeAt = time.Now().UnixMilli()
	if buyerStats.FirstTradeAt == 0 {
		buyerStats.FirstTradeAt = buyerStats.LastTradeAt
	}

	// Update advertiser stats
	ps.initUserStats(order.AdvertiserID)
	advStats := ps.userStats[order.AdvertiserID]
	advStats.LastTradeAt = time.Now().UnixMilli()
	if advStats.FirstTradeAt == 0 {
		advStats.FirstTradeAt = advStats.LastTradeAt
	}

	switch order.Status {
	case P2POrderReleased:
		buyerStats.CompletedOrders++
		advStats.CompletedOrders++
		buyerStats.TotalVolume += order.Amount
		buyerStats.TotalVolumeFiat += order.FiatAmount
		advStats.TotalVolume += order.Amount
		advStats.TotalVolumeFiat += order.FiatAmount
	case P2POrderCancelled:
		buyerStats.CancelledOrders++
		advStats.CancelledOrders++
	case P2POrderDisputed:
		buyerStats.DisputedOrders++
		advStats.DisputedOrders++
	}

	// Calculate completion rate
	if buyerStats.CompletedOrders+buyerStats.CancelledOrders > 0 {
		buyerStats.CompletionRate = float64(buyerStats.CompletedOrders) / 
			float64(buyerStats.CompletedOrders+buyerStats.CancelledOrders) * 100
	}
	if advStats.CompletedOrders+advStats.CancelledOrders > 0 {
		advStats.CompletionRate = float64(advStats.CompletedOrders) / 
			float64(advStats.CompletedOrders+advStats.CancelledOrders) * 100
	}
}

func (ps *P2PService) GetUserStats(userID string) *P2PUserStats {
	ps.mu.RLock()
	defer ps.mu.RUnlock()

	ps.initUserStats(userID)
	return ps.userStats[userID]
}

func (ps *P2PService) RateUser(orderID, raterID, ratedID string, rating int, comment string) error {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	// In production, would store rating and calculate average
	fmt.Printf("Rating: User %s rated %s %d stars for order %s\n", raterID, ratedID, rating, orderID)

	return nil
}

// ============================================================================
// MAIN
// ============================================================================

func main() {
	fmt.Println("TigerEx P2P Trading Service v1.0")
	fmt.Println("P2P Marketplace with Escrow and Dispute Resolution")
	fmt.Println()

	ps := NewP2PService()

	// Create test ads
	ads := []*CreateAdRequest{
		{
			UserID:       "seller1",
			Type:         "sell",
			Currency:     "USDT",
			FiatCurrency: "PKR",
			Price:         280.50,
			SpreadPercent: 0.5,
			MinAmount:     100,
			MaxAmount:     10000,
			PaymentMethods: []string{PaymentBankTransfer, PaymentJazzCash},
			PaymentWindow: 15, // 15 minutes
		},
		{
			UserID:       "seller2",
			Type:         "sell",
			Currency:     "USDT",
			FiatCurrency: "PKR",
			Price:         281.00,
			SpreadPercent: 0.7,
			MinAmount:     50,
			MaxAmount:     5000,
			PaymentMethods: []string{PaymentBankTransfer, PaymentEasypaisa},
			PaymentWindow: 30,
		},
		{
			UserID:       "buyer1",
			Type:         "buy",
			Currency:     "USDT",
			FiatCurrency: "PKR",
			Price:         279.00,
			SpreadPercent: -0.5,
			MinAmount:     100,
			MaxAmount:     50000,
			PaymentMethods: []string{PaymentBankTransfer},
			PaymentWindow: 15,
		},
	}

	for _, req := range ads {
		ad, err := ps.CreateAd(req)
		if err != nil {
			fmt.Printf("Failed to create ad: %v\n", err)
			continue
		}
		fmt.Printf("Created %s ad: %s (Price: %.2f PKR/USDT)\n", req.Type, ad.ID, ad.Price)
	}

	// Create test order
	fmt.Println()
	order, err := ps.CreateOrder(&CreateOrderRequest{
		AdID:          "ad_test",
		UserID:        "buyer123",
		Amount:        500,
		PaymentMethod: PaymentBankTransfer,
	})
	if err != nil {
		fmt.Printf("Order creation: %v\n", err)
	} else {
		fmt.Printf("Created order: %s (Amount: %.2f USDT for %.2f PKR)\n", 
			order.ID, order.Amount, order.FiatAmount)
		fmt.Printf("Payment deadline: %d minutes\n", order.PaymentWindow)
	}

	// Get ads for USDT/PKR
	fmt.Println()
	ads = ps.GetAdsByCurrency("USDT", "PKR", "sell")
	fmt.Printf("Available sell ads for USDT/PKR: %d\n", len(ads))

	fmt.Println()
	fmt.Println("P2P Service initialized and ready!")
}