// Package p2p provides P2P trading services
package p2p

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"tigerex-api/internal/api"
)

var (
	ErrAdNotFound = errors.New("ad not found")
	ErrOrderNotFound = errors.New("order not found")
	ErrInvalidAmount = errors.New("invalid amount")
	ErrPriceMismatch = errors.New("price mismatch")
	ErrStatusInvalid = errors.New("invalid status")
)

// Config holds P2P configuration
type Config struct {
	MinOrderAmount float64
	MaxOrderAmount float64
	PaymentWindowMinutes int
	DisputeWindowHours int
}

// Ad represents a P2P advertisement
type Ad struct {
	ID            string    `json:"id"`
	UserID       string    `json:"userId"`
	Type         string    `json:"type"` // "buy" or "sell"
	Asset        string    `json:"asset"`
	FiatCurrency string    `json:"fiatCurrency"`
	PriceType    string    `json:"priceType"` // "fixed" or "浮动"
	PriceMargin  float64   `json:"priceMargin"` // percentage
	FixedPrice   float64   `json:"fixedPrice"`
	MinAmount    float64   `json:"minAmount"`
	MaxAmount    float64   `json:"maxAmount"`
	PaymentMethods []string `json:"paymentMethods"`
	Terms        string    `json:"terms"`
	Status       string    `json:"status"` // "active", "paused", "closed"
	CompletedOrders int     `json:"completedOrders"`
	AvgCompletionTime float64 `json:"avgCompletionTime"`
	Rating        float64   `json:"rating"`
	CreatedAt     int64     `json:"createdAt"`
	UpdatedAt     int64     `json:"updatedAt"`
}

// Order represents a P2P order
type Order struct {
	ID              string    `json:"id"`
	AdID           string    `json:"adId"`
	CreatorID      string    `json:"creatorId"`
	CounterpartyID string    `json:"counterpartyId"`
	Asset          string    `json:"asset"`
	Amount         float64   `json:"amount"`
	FiatAmount     float64   `json:"fiatAmount"`
	FiatCurrency  string    `json:"fiatCurrency"`
	Price          float64   `json:"price"`
	Status         string    `json:"status"` // "pending", "waiting_payment", "paid", "released", "cancelled", "disputed"
	PaymentMethod  string    `json:"paymentMethod"`
	PaymentProof   string    `json:"paymentProof"`
	Remark         string    `json:"remark"`
	DisputeReason  string    `json:"disputeReason"`
	DisputeResult string    `json:"disputeResult"`
	CreatedAt      int64     `json:"createdAt"`
	PaidAt         int64     `json:"paidAt"`
	ReleasedAt     int64     `json:"releasedAt"`
	CancelledAt    int64     `json:"cancelledAt"`
}

// Dispute represents a dispute
type Dispute struct {
	ID            string    `json:"id"`
	OrderID       string    `json:"orderId"`
	ReporterID    string    `json:"reporterId"`
	Reason        string    `json:"reason"`
	Description   string    `json:"description"`
	Evidence      []string  `json:"evidence"`
	Status        string    `json:"status"` // "open", "appealed", "resolved", "cancelled"
	Resolution    string    `json:"resolution"`
	ResolvedBy    string    `json:"resolvedBy"`
	CreatedAt     int64     `json:"createdAt"`
	ResolvedAt    int64     `json:"resolvedAt"`
}

// Service handles P2P operations
type Service struct {
	config    Config
	ads      map[string]*Ad
	orders   map[string]*Order
	disputes map[string]*Dispute
}

func NewService(config Config) *Service {
	return &Service{
		config: config,
		ads: make(map[string]*Ad),
		orders: make(map[string]*Order),
		disputes: make(map[string]*Dispute),
	}
}

// CreateAd creates a new P2P advertisement
func (s *Service) CreateAd(ctx context.Context, ad *Ad) (*Ad, error) {
	if ad.MinAmount < s.config.MinOrderAmount {
		return nil, ErrInvalidAmount
	}

	now := api.Now()
	ad.ID = uuid.New().String()
	ad.Status = "active"
	ad.CompletedOrders = 0
	ad.AvgCompletionTime = 0
	ad.Rating = 0
	ad.CreatedAt = now
	ad.UpdatedAt = now

	s.ads[ad.ID] = ad
	return ad, nil
}

// UpdateAd updates a P2P advertisement
func (s *Service) UpdateAd(ctx context.Context, userID, adID string, updates map[string]interface{}) (*Ad, error) {
	ad, ok := s.ads[adID]
	if !ok {
		return nil, ErrAdNotFound
	}

	if ad.UserID != userID {
		return nil, errors.New("unauthorized")
	}

	// Apply updates
	if v, ok := updates["priceMargin"]; ok {
		ad.PriceMargin = v.(float64)
	}
	if v, ok := updates["minAmount"]; ok {
		ad.MinAmount = v.(float64)
	}
	if v, ok := updates["maxAmount"]; ok {
		ad.MaxAmount = v.(float64)
	}
	if v, ok := updates["status"]; ok {
		ad.Status = v.(string)
	}
	if v, ok := updates["paymentMethods"]; ok {
		ad.PaymentMethods = v.([]string)
	}

	ad.UpdatedAt = api.Now()
	return ad, nil
}

// GetAd returns an advertisement
func (s *Service) GetAd(adID string) (*Ad, error) {
	ad, ok := s.ads[adID]
	if !ok {
		return nil, ErrAdNotFound
	}
	return ad, nil
}

// GetAdsByUser returns all ads for a user
func (s *Service) GetAdsByUser(userID string) []*Ad {
	result := make([]*Ad, 0)
	for _, ad := range s.ads {
		if ad.UserID == userID {
			result = append(result, ad)
		}
	}
	return result
}

// SearchAds searches for P2P advertisements
func (s *Service) SearchAds(asset, fiatCurrency, adType string, paymentMethod string) []*Ad {
	result := make([]*Ad, 0)
	for _, ad := range s.ads {
		if ad.Status != "active" {
			continue
		}
		if ad.Asset != asset || ad.FiatCurrency != fiatCurrency {
			continue
		}
		if adType != "" && ad.Type != adType {
			continue
		}
		if paymentMethod != "" {
			found := false
			for _, pm := range ad.PaymentMethods {
				if pm == paymentMethod {
					found = true
					break
				}
			}
			if !found {
				continue
			}
		}
		result = append(result, ad)
	}
	return result
}

// CreateOrder creates a P2P order
func (s *Service) CreateOrder(ctx context.Context, userID, adID string, amount float64) (*Order, error) {
	ad, ok := s.ads[adID]
	if !ok {
		return nil, ErrAdNotFound
	}

	if ad.Status != "active" {
		return nil, ErrStatusInvalid
	}

	if amount < ad.MinAmount || amount > ad.MaxAmount {
		return nil, ErrInvalidAmount
	}

	// Calculate fiat amount
	fiatAmount := amount * ad.FixedPrice
	if ad.PriceType == "浮动" {
		// Would need current market price
		fiatAmount = amount * 45000 // placeholder
	}

	order := &Order{
		ID:              uuid.New().String(),
		AdID:           adID,
		CreatorID:      userID,
		CounterpartyID: ad.UserID,
		Asset:          ad.Asset,
		Amount:         amount,
		FiatAmount:     fiatAmount,
		FiatCurrency:   ad.FiatCurrency,
		Price:          ad.FixedPrice,
		Status:         "pending",
		PaymentMethod:  ad.PaymentMethods[0],
		CreatedAt:      api.Now(),
	}

	// If creator is buyer, swap roles
	if ad.Type == "buy" {
		order.CounterpartyID = ad.UserID
	}

	s.orders[order.ID] = order
	return order, nil
}

// Pay marks order as paid
func (s *Service) Pay(ctx context.Context, userID, orderID, paymentProof string) (*Order, error) {
	order, ok := s.orders[orderID]
	if !ok {
		return nil, ErrOrderNotFound
	}

	if order.CreatorID != userID {
		return nil, errors.New("unauthorized")
	}

	if order.Status != "pending" {
		return nil, ErrStatusInvalid
	}

	order.Status = "waiting_payment"
	order.PaymentProof = paymentProof
	order.PaidAt = api.Now()

	return order, nil
}

// ConfirmPayment confirms payment received
func (s *Service) ConfirmPayment(ctx context.Context, userID, orderID string) (*Order, error) {
	order, ok := s.orders[orderID]
	if !ok {
		return nil, ErrOrderNotFound
	}

	if order.CounterpartyID != userID {
		return nil, errors.New("unauthorized")
	}

	if order.Status != "waiting_payment" {
		return nil, ErrStatusInvalid
	}

	order.Status = "paid"
	order.ReleasedAt = api.Now()

	// Update ad stats
	if ad, ok := s.ads[order.AdID]; ok {
		ad.CompletedOrders++
	}

	return order, nil
}

// Release releases crypto to buyer
func (s *Service) Release(ctx context.Context, userID, orderID string) (*Order, error) {
	order, ok := s.orders[orderID]
	if !ok {
		return nil, ErrOrderNotFound
	}

	if order.CounterpartyID != userID {
		return nil, errors.New("unauthorized")
	}

	if order.Status != "paid" {
		return nil, ErrStatusInvalid
	}

	order.Status = "released"
	order.ReleasedAt = api.Now()

	return order, nil
}

// Cancel cancels an order
func (s *Service) Cancel(ctx context.Context, userID, orderID string) (*Order, error) {
	order, ok := s.orders[orderID]
	if !ok {
		return nil, ErrOrderNotFound
	}

	if order.CreatorID != userID && order.CounterpartyID != userID {
		return nil, errors.New("unauthorized")
	}

	if order.Status != "pending" && order.Status != "waiting_payment" {
		return nil, ErrStatusInvalid
	}

	order.Status = "cancelled"
	order.CancelledAt = api.Now()

	return order, nil
}

// Dispute opens a dispute
func (s *Service) Dispute(ctx context.Context, userID, orderID, reason, description string) (*Dispute, error) {
	order, ok := s.orders[orderID]
	if !ok {
		return nil, ErrOrderNotFound
	}

	if order.CreatorID != userID && order.CounterpartyID != userID {
		return nil, errors.New("unauthorized")
	}

	if order.Status != "waiting_payment" && order.Status != "paid" {
		return nil, ErrStatusInvalid
	}

	order.Status = "disputed"

	dispute := &Dispute{
		ID:          uuid.New().String(),
		OrderID:     orderID,
		ReporterID:  userID,
		Reason:      reason,
		Description: description,
		Status:      "open",
		CreatedAt:   api.Now(),
	}

	s.disputes[dispute.ID] = dispute
	return dispute, nil
}

// ResolveDispute resolves a dispute
func (s *Service) ResolveDispute(disputeID, resolution, resolvedBy string) (*Dispute, error) {
	dispute, ok := s.disputes[disputeID]
	if !ok {
		return nil, errors.New("dispute not found")
	}

	dispute.Status = "resolved"
	dispute.Resolution = resolution
	dispute.ResolvedBy = resolvedBy
	dispute.ResolvedAt = api.Now()

	// Update order status
	if order, ok := s.orders[dispute.OrderID]; ok {
		if resolution == "release" {
			order.Status = "released"
		} else if resolution == "refund" {
			order.Status = "cancelled"
		}
		order.DisputeResult = resolution
		order.ReleasedAt = api.Now()
	}

	return dispute, nil
}

// GetUserOrders returns all orders for a user
func (s *Service) GetUserOrders(userID string) []*Order {
	result := make([]*Order, 0)
	for _, order := range s.orders {
		if order.CreatorID == userID || order.CounterpartyID == userID {
			result = append(result, order)
		}
	}
	return result
}

// GetOrder returns an order
func (s *Service) GetOrder(orderID string) (*Order, error) {
	order, ok := s.orders[orderID]
	if !ok {
		return nil, ErrOrderNotFound
	}
	return order, nil
}

// PaymentMethod represents available payment methods
type PaymentMethod struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Type    string `json:"type"` // "bank", "wallet", "card"
	Enabled bool   `json:"enabled"`
}

// GetPaymentMethods returns available payment methods
func (s *Service) GetPaymentMethods() []*PaymentMethod {
	return []*PaymentMethod{
		{ID: "bank_transfer", Name: "Bank Transfer", Type: "bank", Enabled: true},
		{ID: "credit_card", Name: "Credit/Debit Card", Type: "card", Enabled: true},
		{ID: "paypal", Name: "PayPal", Type: "wallet", Enabled: true},
		{ID: "wise", Name: "Wise", Type: "wallet", Enabled: true},
		{ID: "revolut", Name: "Revolut", Type: "wallet", Enabled: true},
		{ID: "skrill", Name: "Skrill", Type: "wallet", Enabled: true},
		{ID: "cash_deposit", Name: "Cash Deposit", Type: "bank", Enabled: true},
		{ID: "alipay", Name: "Alipay", Type: "wallet", Enabled: true},
		{ID: "wechat", Name: "WeChat Pay", Type: "wallet", Enabled: true},
	}
}