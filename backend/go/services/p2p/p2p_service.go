// TigerEx P2P Trading Service
// Peer-to-peer trading platform for fiat-crypto

package p2p

import (
	"errors"
	"fmt"
	"sync"
	"time"
)

const (
	StatusOpen     = "open"
	StatusPending  = "pending"
	StatusPaid     = "paid"
	StatusReleased = "released"
	StatusCancelled = "cancelled"
	StatusDisputed = "disputed"
	StatusExpired  = "expired"

	OrderTypeBuy = "buy"
	OrderTypeSell = "sell"

	PaymentMethodBank    = "bank_transfer"
	PaymentMethodSEPA   = "sepa"
	PaymentMethodSwift  = "swift"
	PaymentMethodCard   = "credit_card"
	PaymentMethodPayPal = "paypal"
	PaymentMethodCash   = "cash"

	FiatCurrencyUSD = "USD"
	FiatCurrencyEUR = "EUR"
	FiatCurrencyGBP = "GBP"
	FiatCurrencyJPY = "JPY"
	FiatCurrencyINR = "INR"
	FiatCurrencyBRL = "BRL"
)

type P2POrder struct {
	ID            string    `json:"id"`
	OwnerID      string    `json:"owner_id"`
	Type         string    `json:"type"`
	CryptoAsset  string    `json:"crypto_asset"`
	FiatCurrency string    `json:"fiat_currency"`
	Amount       float64   `json:"amount"`
	Price        float64   `json:"price"`
	TotalAmount  float64   `json:"total_amount"`
	MinAmount    float64   `json:"min_amount"`
	MaxAmount    float64   `json:"max_amount"`
	PaymentMethod string   `json:"payment_method"`
	Terms        string    `json:"terms"`
	Status       string    `json:"status"`
	OrdersCount  int       `json:"orders_count"`
	OrdersDone   int       `json:"orders_done"`
	CompletionRate float64 `json:"completion_rate"`
	AvgReleaseTime float64 `json:"avg_release_time"`
	TradeLimit   float64   `json:"trade_limit"`
	CreatedAt    time.Time `json:"created_at"`
	ExpiresAt    time.Time `json:"expires_at"`
}

type P2PTrade struct {
	ID             string    `json:"id"`
	OrderID       string    `json:"order_id"`
	BuyerID       string    `json:"buyer_id"`
	SellerID      string    `json:"seller_id"`
	CryptoAsset   string    `json:"crypto_asset"`
	FiatCurrency  string    `json:"fiat_currency"`
	Amount        float64   `json:"amount"`
	Price         float64   `json:"price"`
	TotalAmount   float64   `json:"total_amount"`
	Status        string    `json:"status"`
	BuyerPaidAt   time.Time `json:"buyer_paid_at"`
	ReleasedAt    time.Time `json:"released_at"`
	DisputeReason string    `json:"dispute_reason"`
	CreatedAt     time.Time `json:"created_at"`
	ExpiresAt     time.Time `json:"expires_at"`
}

type Dispute struct {
	ID          string    `json:"id"`
	TradeID     string    `json:"trade_id"`
	ReporterID string    `json:"reporter_id"`
	Reason      string    `json:"reason"`
	Description string    `json:"description"`
	Status      string    `json:"status"`
	Resolution  string    `json:"resolution"`
	CreatedAt   time.Time `json:"created_at"`
	ResolvedAt  time.Time `json:"resolved_at"`
}

type P2PManager struct {
	mu          sync.RWMutex
	orders      map[string]*P2POrder
	trades     map[string]*P2PTrade
	disputes    map[string]*Dispute
	userOrders map[string][]string
}

func NewP2PManager() *P2PManager {
	return &P2PManager{
		orders:     make(map[string]*P2POrder),
		trades:    make(map[string]*P2PTrade),
		disputes:  make(map[string]*Dispute),
		userOrders: make(map[string][]string),
	}
}

func (pm *P2PManager) CreateOrder(ownerID, orderType, cryptoAsset, fiatCurrency, paymentMethod string, amount, price, minAmount, maxAmount float64, terms string) (*P2POrder, error) {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	if amount <= 0 || price <= 0 {
		return nil, errors.New("amount and price must be positive")
	}

	now := time.Now()
	order := &P2POrder{
		ID:             fmt.Sprintf("P2P%d%d", now.Unix(), now.Nanosecond()),
		OwnerID:        ownerID,
		Type:           orderType,
		CryptoAsset:   cryptoAsset,
		FiatCurrency:  fiatCurrency,
		Amount:        amount,
		Price:         price,
		TotalAmount:   amount * price,
		MinAmount:     minAmount,
		MaxAmount:     maxAmount,
		PaymentMethod: paymentMethod,
		Terms:         terms,
		Status:        StatusOpen,
		OrdersCount:   0,
		OrdersDone:    0,
		CompletionRate: 100.0,
		AvgReleaseTime: 0,
		TradeLimit:    0,
		CreatedAt:     now,
		ExpiresAt:     now.Add(7 * 24 * time.Hour),
	}

	pm.orders[order.ID] = order
	pm.userOrders[ownerID] = append(pm.userOrders[ownerID], order.ID)

	return order, nil
}

func (pm *P2PManager) GetOrder(orderID string) (*P2POrder, error) {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	order, exists := pm.orders[orderID]
	if !exists {
		return nil, errors.New("order not found")
	}
	return order, nil
}

func (pm *P2PManager) GetOrders(filters map[string]string, limit, offset int) []*P2POrder {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	var results []*P2POrder
	for _, order := range pm.orders {
		if order.Status != StatusOpen {
			continue
		}
		if filters["type"] != "" && order.Type != filters["type"] {
			continue
		}
		if filters["crypto_asset"] != "" && order.CryptoAsset != filters["crypto_asset"] {
			continue
		}
		if filters["fiat_currency"] != "" && order.FiatCurrency != filters["fiat_currency"] {
			continue
		}
		if filters["payment_method"] != "" && order.PaymentMethod != filters["payment_method"] {
			continue
		}
		results = append(results, order)
	}

	if offset > len(results) {
		offset = len(results)
	}
	if offset+limit > len(results) {
		limit = len(results) - offset
	}

	return results[offset : offset+limit]
}

func (pm *P2PManager) CancelOrder(orderID, userID string) error {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	order, exists := pm.orders[orderID]
	if !exists {
		return errors.New("order not found")
	}

	if order.OwnerID != userID {
		return errors.New("unauthorized")
	}

	if order.Status != StatusOpen {
		return errors.New("order cannot be cancelled")
	}

	order.Status = StatusCancelled
	return nil
}

func (pm *P2PManager) StartTrade(orderID, buyerID string, amount float64) (*P2PTrade, error) {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	order, exists := pm.orders[orderID]
	if !exists {
		return nil, errors.New("order not found")
	}

	if order.Status != StatusOpen {
		return nil, errors.New("order is not available")
	}

	if order.OwnerID == buyerID {
		return nil, errors.New("cannot trade with yourself")
	}

	if amount < order.MinAmount || amount > order.MaxAmount {
		return nil, errors.New("amount outside allowed range")
	}

	totalAmount := amount * order.Price

	now := time.Now()
	trade := &P2PTrade{
		ID:            fmt.Sprintf("TRD%d%d", now.Unix(), now.Nanosecond()),
		OrderID:      orderID,
		BuyerID:      buyerID,
		SellerID:     order.OwnerID,
		CryptoAsset:  order.CryptoAsset,
		FiatCurrency: order.FiatCurrency,
		Amount:       amount,
		Price:        order.Price,
		TotalAmount:  totalAmount,
		Status:       StatusPending,
		CreatedAt:    now,
		ExpiresAt:    now.Add(30 * time.Minute),
	}

	pm.trades[trade.ID] = trade

	order.Status = StatusPending
	order.OrdersCount++

	return trade, nil
}

func (pm *P2PManager) ConfirmPayment(tradeID, userID string) error {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	trade, exists := pm.trades[tradeID]
	if !exists {
		return errors.New("trade not found")
	}

	if trade.BuyerID != userID {
		return errors.New("only buyer can confirm payment")
	}

	if trade.Status != StatusPending {
		return errors.New("trade is not pending")
	}

	trade.Status = StatusPaid
	trade.BuyerPaidAt = time.Now()

	return nil
}

func (pm *P2PManager) ReleaseCrypto(tradeID, userID string) error {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	trade, exists := pm.trades[tradeID]
	if !exists {
		return errors.New("trade not found")
	}

	if trade.SellerID != userID {
		return errors.New("only seller can release crypto")
	}

	if trade.Status != StatusPaid {
		return errors.New("payment not confirmed")
	}

	trade.Status = StatusReleased
	trade.ReleasedAt = time.Now()

	order, exists := pm.orders[trade.OrderID]
	if exists {
		order.OrdersDone++
		order.Status = StatusOpen
	}

	return nil
}

func (pm *P2PManager) CancelTrade(tradeID, userID string) error {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	trade, exists := pm.trades[tradeID]
	if !exists {
		return errors.New("trade not found")
	}

	if trade.BuyerID != userID && trade.SellerID != userID {
		return errors.New("unauthorized")
	}

	if trade.Status == StatusReleased {
		return errors.New("cannot cancel released trade")
	}

	trade.Status = StatusCancelled

	order, exists := pm.orders[trade.OrderID]
	if exists {
		order.Status = StatusOpen
	}

	return nil
}

func (pm *P2PManager) OpenDispute(tradeID, reporterID, reason, description string) (*Dispute, error) {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	trade, exists := pm.trades[tradeID]
	if !exists {
		return nil, errors.New("trade not found")
	}

	if trade.BuyerID != reporterID && trade.SellerID != reporterID {
		return nil, errors.New("unauthorized")
	}

	if trade.Status != StatusPaid {
		return nil, errors.New("can only dispute paid trades")
	}

	now := time.Now()
	dispute := &Dispute{
		ID:          fmt.Sprintf("DSP%d%d", now.Unix(), now.Nanosecond()),
		TradeID:     tradeID,
		ReporterID:  reporterID,
		Reason:      reason,
		Description: description,
		Status:      "open",
		CreatedAt:   now,
	}

	pm.disputes[dispute.ID] = dispute
	trade.Status = StatusDisputed

	return dispute, nil
}

func (pm *P2PManager) ResolveDispute(disputeID, resolution string, resolvedBy string) error {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	dispute, exists := pm.disputes[disputeID]
	if !exists {
		return errors.New("dispute not found")
	}

	dispute.Status = "resolved"
	dispute.Resolution = resolution
	dispute.ResolvedAt = time.Now()

	trade, exists := pm.trades[dispute.TradeID]
	if exists {
		if resolution == "release" {
			trade.Status = StatusReleased
			trade.ReleasedAt = time.Now()
		} else if resolution == "cancel" {
			trade.Status = StatusCancelled
		}
	}

	return nil
}

func (pm *P2PManager) GetTrade(tradeID string) (*P2PTrade, error) {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	trade, exists := pm.trades[tradeID]
	if !exists {
		return nil, errors.New("trade not found")
	}
	return trade, nil
}

func (pm *P2PManager) GetUserTrades(userID string) []*P2PTrade {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	var trades []*P2PTrade
	for _, trade := range pm.trades {
		if trade.BuyerID == userID || trade.SellerID == userID {
			trades = append(trades, trade)
		}
	}
	return trades
}

func (pm *P2PManager) GetUserOrders(userID string) []*P2POrder {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	orderIDs := pm.userOrders[userID]
	orders := make([]*P2POrder, 0, len(orderIDs))
	for _, id := range orderIDs {
		if order, exists := pm.orders[id]; exists {
			orders = append(orders, order)
		}
	}
	return orders
}

func (pm *P2PManager) GetPaymentMethods() []string {
	return []string{
		PaymentMethodBank,
		PaymentMethodSEPA,
		PaymentMethodSwift,
		PaymentMethodCard,
		PaymentMethodPayPal,
		PaymentMethodCash,
	}
}

func (pm *P2PManager) GetFiatCurrencies() []string {
	return []string{
		FiatCurrencyUSD,
		FiatCurrencyEUR,
		FiatCurrencyGBP,
		FiatCurrencyJPY,
		FiatCurrencyINR,
		FiatCurrencyBRL,
	}
}
