package p2p

import (
	"fmt"
	"sync"
	"time"
)

// =============================================================================
// P2P TRADING SERVICE
// Peer-to-peer trading with escrow
// =============================================================================

// Advert represents a P2P advertisement
type Advert struct {
	ID          string    `json:"id"`
	UserID     string    `json:"userId"`
	Side       string    `json:"side"` // BUY, SELL
	Asset      string    `json:"asset"`
	Fiat      string    `json:"fiat"`
	PriceType  string    `json:"priceType"` // FIXED, FLOAT
	PriceOffset float64 `json:"priceOffset"` // % or fixed
	MinAmount  float64  `json:"minAmount"`
	MaxAmount  float64  `json:"maxAmount"`
	LimitsDays int      `json:"limitsDays"` // payment window days
	Terms     string   `json:"terms"`
	Status    string   `json:"status"` // ACTIVE, PAUSED, CANCELLED
	Orders    int64    `json:"orders"`
	Volume    float64  `json:"volume"`
	Rating    float64  `json:"rating"`
	CreatedAt time.Time `json:"createdAt"`
}

// Order represents a P2P order
type Order struct {
	ID          string    `json:"id"`
	AdvertID   string    `json:"advertId"`
	Advertiser string    `json:"advertiser"`
	Buyer     string    `json:"buyer"`
	Seller    string    `json:"seller"`
	Fiat      string    `json:"fiat"`
	Asset     string    `json:"asset"`
	Side      string    `json:"side"` // BUY from advertiser perspective
	Amount    float64   `json:"amount"`
	Price     float64   `json:"price"`
	Total     float64   `json:"total"`
	Status    string    `json:"status"` // PENDING, WAITING_PAYMENT, PAID, RELEASED, CANCELLED, DISPUTE
	ExpiresAt  time.Time `json:"expiresAt"`
	PaidAt    *time.Time `json:"paidAt,omitempty"`
	ReleasedAt *time.Time `json:"releasedAt,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

// Dispute dispute record
type Dispute struct {
	ID        string    `json:"id"`
	OrderID  string    `json:"orderId"`
	Opener   string    `json:"opener"`
	Reason   string    `json:"reason"`
	Status   string    `json:"status"` // OPEN, RESOLVED_BUYER, RESOLVED_SELLER, CLOSED
	Evidence string   `json:"evidence"`
	Resolution string  `json:"resolution"`
	OpenedAt time.Time `json:"openedAt"`
}

// Service P2P service
type Service struct {
	mu sync.RWMutex

	// Adverts
	adverts map[string]*Advert
	userAdverts map[string]map[string]*Advert // userID -> advertID -> advert

	// Orders
	orders map[string]*Order
	orderAdverts map[string][]string // advertID -> orderIDs

	// Disputes
	disputes map[string]*Dispute

	// Settings
	CancelWindowMinutes int
	ReleaseWindowMinutes int
	MaxDisputes int
}

// NewService creates P2P service
func NewService() *Service {
	return &Service{
		adverts:            make(map[string]*Advert),
		userAdverts:         make(map[string]map[string]*Advert),
		orders:            make(map[string]*Order),
		orderAdverts:       make(map[string][]string),
		disputes:          make(map[string]*Dispute),
		CancelWindowMinutes: 15,
		ReleaseWindowMinutes: 30,
		MaxDisputes:       3,
	}
}

// CreateAdvert creates advertisement
func (s *Service) CreateAdvert(advert *Advert) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if advert.MinAmount <= 0 || advert.MaxAmount <= 0 {
		return fmt.Errorf("invalid amounts")
	}

	if advert.MinAmount > advert.MaxAmount {
		return fmt.Errorf("min > max")
	}

	if advert.Status == "" {
		advert.Status = "ACTIVE"
	}
	if advert.CreatedAt.IsZero() {
		advert.CreatedAt = time.Now()
	}

	s.adverts[advert.ID] = advert
	if s.userAdverts[advert.UserID] == nil {
		s.userAdverts[advert.UserID] = make(map[string]*Advert)
	}
	s.userAdverts[advert.UserID][advert.ID] = advert

	return nil
}

// GetAdverts gets active adverts
func (s *Service) GetAdverts(asset, fiat, side string) []*Advert {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var results []*Advert
	for _, advert := range s.adverts {
		if advert.Status != "ACTIVE" {
			continue
		}
		if advert.Asset != asset || advert.Fiat != fiat || advert.Side != side {
			continue
		}
		results = append(results, advert)
	}

	return results
}

// CreateOrder creates P2P order
func (s *Service) CreateOrder(advertID, buyerID string, amount float64) (*Order, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	advert, ok := s.adverts[advertID]
	if !ok {
		return nil, fmt.Errorf("advert not found")
	}

	if advert.Status != "ACTIVE" {
		return nil, fmt.Errorf("advert not active")
	}

	if amount < advert.MinAmount || amount > advert.MaxAmount {
		return nil, fmt.Errorf("amount outside limits")
	}

	// Calculate price
	price := s.calculatePrice(advert)
	total := price * amount

	order := &Order{
		ID:         generateID(),
		AdvertID:  advertID,
		Advertiser: advert.UserID,
		Buyer:     buyerID,
		Fiat:      advert.Fiat,
		Asset:     advert.Asset,
		Side:      advert.Side,
		Amount:    amount,
		Price:     price,
		Total:     total,
		Status:   "WAITING_PAYMENT",
		ExpiresAt: time.Now().Add(time.Duration(s.CancelWindowMinutes) * time.Minute),
		CreatedAt: time.Now(),
	}

	if advert.Side == "SELL" {
		order.Buyer = advert.UserID
	} else {
		order.Seller = advert.UserID
	}

	s.orders[order.ID] = order
	s.orderAdverts[advertID] = append(s.orderAdverts[advertID], order.ID)

	return order, nil
}

// calculatePrice calculates price from advert
func (s *Service) calculatePrice(advert *Advert) float64 {
	if advert.PriceType == "FIXED" {
		return advert.PriceOffset
	}
	// Floating - offset from market (simplified)
	return advert.PriceOffset
}

// MarkAsPaid marks order as paid
func (s *Service) MarkAsPaid(orderID, userID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	order, ok := s.orders[orderID]
	if !ok {
		return fmt.Errorf("order not found")
	}

	if order.Status != "WAITING_PAYMENT" {
		return fmt.Errorf("order not awaiting payment")
	}

	// Verify user is buyer
	isBuyer := (order.Side == "SELL" && userID == order.Buyer) ||
		(order.Side == "BUY" && userID == order.Seller)

	if !isBuyer {
		return fmt.Errorf("not authorized")
	}

	order.Status = "PAID"
	now := time.Now()
	order.PaidAt = &now

	return nil
}

// Release releases crypto to buyer
func (s *Service) Release(orderID, userID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	order, ok := s.orders[orderID]
	if !ok {
		return fmt.Errorf("order not found")
	}

	if order.Status != "PAID" {
		return fmt.Errorf("order not paid")
	}

	isSeller := userID == order.Seller
	if !isSeller {
		return fmt.Errorf("only seller can release")
	}

	order.Status = "RELEASED"
	now := time.Now()
	order.ReleasedAt = &now

	return nil
}

// Cancel cancels order
func (s *Service) Cancel(orderID, userID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	order, ok := s.orders[orderID]
	if !ok {
		return fmt.Errorf("order not found")
	}

	if order.Status != "WAITING_PAYMENT" {
		return fmt.Errorf("cannot cancel")
	}

	// Check if within window
	if time.Now().After(order.ExpiresAt) {
		return fmt.Errorf("cancellation window expired")
	}

	order.Status = "CANCELLED"

	return nil
}

// OpenDispute opens dispute
func (s *Service) OpenDispute(orderID, userID, reason string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	order, ok := s.orders[orderID]
	if !ok {
		return fmt.Errorf("order not found")
	}

	if order.Status != "PAID" && order.Status != "WAITING_PAYMENT" {
		return fmt.Errorf("cannot dispute")
	}

	dispute := &Dispute{
		ID:       generateID(),
		OrderID: orderID,
		Opener:  userID,
		Reason:  reason,
		Status:  "OPEN",
		OpenedAt: time.Now(),
	}

	s.disputes[dispute.ID] = dispute
	order.Status = "DISPUTE"

	return nil
}

// GetOrder gets order
func (s *Service) GetOrder(orderID string) (*Order, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	order, ok := s.orders[orderID]
	if !ok {
		return nil, fmt.Errorf("order not found")
	}

	return order, nil
}

// GetUserOrders gets orders for user
func (s *Service) GetUserOrders(userID string) []*Order {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var orders []*Order
	for _, order := range s.orders {
		if order.Buyer == userID || order.Seller == userID {
			orders = append(orders, order)
		}
	}

	return orders
}

// =============================================================================
// ESCROW RELEASE (called by worker)
// =============================================================================

// ProcessTimeout processes timed-out orders
func (s *Service) ProcessTimeout(orderID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	order, ok := s.orders[orderID]
	if !ok {
		return fmt.Errorf("order not found")
	}

	if order.Status != "WAITING_PAYMENT" {
		return nil
	}

	if time.Now().Before(order.ExpiresAt) {
		return nil
	}

	order.Status = "CANCELLED"

	return nil
}

// =============================================================================
// HELPER
// =============================================================================

func generateID() string {
	return fmt.Sprintf("%d-%s", time.Now().Unix(), generateToken(8))
}

func generateToken(n int) string {
	b := make([]byte, n)
	for i := range b {
		b[i] = "abcdef0123456789"[i%16]
	}
	return string(b)
}