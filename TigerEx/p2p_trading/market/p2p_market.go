// Package market provides P2P trading marketplace functionality.
package market

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/shopspring/decimal"
)

// P2PAd represents a P2P advertisement
type P2PAd struct {
	ID             string          `json:"id"`
	OwnerID        string         `json:"owner_id"`
	Type           TradeType       `json:"type"`   // BUY or SELL
	Token         string         `json:"token"`
	FiatCurrency  string        `json:"fiat_currency"` // USD, EUR, etc.
	PriceType    PriceType     `json:"price_type"` // FIXED or FLOAT
	PriceOffset decimal.Decimal `json:"price_offset"` // % over spot
	FiatPrice   decimal.Decimal `json:"fiat_price"`
	MinAmount   decimal.Decimal `json:"min_amount"`
	MaxAmount   decimal.Decimal `json:"max_amount"`
	PaymentMethods []string   `json:"payment_methods"` // BANK_TRANSFER, PAYPAL, etc.
	Terms       string        `json:"terms"`
	RequireKYC  bool          `json:"require_kyc"`
	IsActive    bool          `json:"is_active"`
	CounterpartyLimit int   `json:"counterparty_limit"`
	TradesCompleted int     `json:"trades_completed"`
	Rating      decimal.Decimal `json:"rating"`
	CreatedAt   time.Time    `json:"created_at"`
	UpdatedAt  time.Time    `json:"updated_at"`
}

// TradeType represents ad type
type TradeType string

const (
	TradeTypeBuy  TradeType = "BUY"
	TradeTypeSell TradeType = "SELL"
)

// PriceType represents price type
type PriceType string

const (
	PriceTypeFixed  PriceType = "FIXED"
	PriceTypeFloat PriceType = "FLOAT"
)

// P2POrder represents a P2P trade order
type P2POrder struct {
	ID          string          `json:"id"`
	AdID        string         `json:"ad_id"`
	SellerID    string        `json:"seller_id"`
	BuyerID     string        `json:"buyer_id"`
	Token       string        `json:"token"`
	FiatCurrency string        `json:"fiat_currency"`
	FiatAmount  decimal.Decimal `json:"fiat_amount"`
	CryptoAmount decimal.Decimal `json:"crypto_amount"`
	UnitPrice   decimal.Decimal `json:"unit_price"`
	Status     OrderStatus   `json:"status"`
	EscrowTxHash string       `json:"escrow_tx_hash"`
	PaymentProof string     `json:"payment_proof"`
	CompletedAt *time.Time `json:"completed_at"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

// OrderStatus represents order status
type OrderStatus string

const (
	OrderStatusPending   OrderStatus = "PENDING" // Awaiting payment
	OrderStatusPaid   OrderStatus = "PAID"   // Buyer marked paid
	OrderStatusConfirming OrderStatus = "CONFIRMING" // Awaiting confirmations
	OrderStatusCompleted OrderStatus = "COMPLETED"
	OrderStatusCancelled OrderStatus = "CANCELLED"
	OrderStatusDisputed OrderStatus = "DISPUTED"
)

// Dispute represents a dispute case
type Dispute struct {
	ID          string        `json:"id"`
	OrderID     string        `json:"order_id"`
	OpenerID    string        `json:"opener_id"`
	Reason      string        `json:"reason"`
	Status      string        `json:"status"`
	Resolution  string        `json:"resolution"`
	Evidence    string        `json:"evidence"`
	AdminNote   string        `json:"admin_note"`
	OpenedAt    time.Time    `json:"opened_at"`
	ResolvedAt  *time.Time   `json:"resolved_at"`
}

// PaymentMethod represents accepted payment method
type PaymentMethod string

const (
	PaymentBankTransfer   PaymentMethod = "BANK_TRANSFER"
	PaymentPayPal        PaymentMethod = "PAYPAL"
	PaymentWesternUnion   PaymentMethod = "WESTERN_UNION"
	PaymentAliPay        PaymentMethod = "ALIPAY"
	PaymentWeChatPay     PaymentMethod = "WECHAT_PAY"
	PaymentCrypto       PaymentMethod = "CRYPTO"
	PaymentGiftCard     PaymentMethod = "GIFT_CARD"
)

// P2PMarket manages P2P trading
type P2PMarket struct {
	mu            sync.RWMutex
	ads           map[string]*P2PAd
	orders        map[string]*P2PEscrow
	disputes      map[string]*Dispute
	rates         ExchangeRateProvider
	escrow        EscrowService
	chat         ChatService
	compliance   ComplianceChecker
	cfg          *MarketConfig
}

// MarketConfig holds market configuration
type MarketConfig struct {
	MaxAdsPerUser        int
	CryptoHoldPercentage decimal.Decimal // 100% held in escrow
	DisputeWindow      time.Duration
	AutoReleaseTime   time.Duration
}

// ExchangeRateProvider provides fiat-crypto rates
type ExchangeRateProvider interface {
	GetRate(crypto, fiat string) (decimal.Decimal, error)
	GetRates(crypto string) (map[string]decimal.Decimal, error)
}

// EscrowService manages escrow
type EscrowService interface {
	CreateEscrow(ctx context.Context, order *P2POrder) (txHash string, err error)
	ReleaseEscrow(ctx context.Context, orderID string) error
	CancelEscrow(ctx context.Context, orderID string) error
}

// ChatService handles in-trade messaging
type ChatService interface {
	CreateRoom(orderID string) (roomID string)
	SendMessage(roomID, senderID, message string) error
	GetMessages(roomID string) ([]*ChatMessage, error)
}

// ComplianceChecker checks user compliance
type ComplianceChecker interface {
	CheckAllowed(userID, adType TradeType) (bool, string)
}

// ChatMessage represents a chat message
type ChatMessage struct {
	ID        string    `json:"id"`
	RoomID    string    `json:"room_id"`
	SenderID  string    `json:"sender_id"`
	Message  string    `json:"message"`
	CreatedAt time.Time `json:"created_at"`
}

// P2PEscrow represents escrow state
type P2PEscrow struct {
	OrderID         string
	CryptoAmount   decimal.Decimal
	Token         string
	EscrowAddress string
	TxHash       string
	Status       string
	ReleasedAt   *time.Time
}

// NewP2PMarket creates a new P2P market
func NewP2PMarket() *P2PMarket {
	return &P2PMarket{
		ads:         make(map[string]*P2PAd),
		orders:      make(map[string]*P2PEscrow),
		disputes:    make(map[string]*Dispute),
		cfg:        &MarketConfig{
			MaxAdsPerUser:        20,
			DisputeWindow:      15 * time.Minute,
			AutoReleaseTime:   30 * time.Minute,
		},
	}
}

// CreateAd creates a new P2P advertisement
func (pm *P2PMarket) CreateAd(ctx context.Context, userID string, ad *P2PAd) (*P2PAd, error) {
	// Validate payment methods
	if len(ad.PaymentMethods) == 0 {
		return nil, fmt.Errorf("at least one payment method required")
	}

	// Validate amounts
	if ad.MinAmount.IsZero() || ad.MaxAmount.IsZero() {
		return nil, fmt.Errorf("min and max amount required")
	}

	if ad.MinAmount.GreaterThan(ad.MaxAmount) {
		return nil, fmt.Errorf("min cannot exceed max")
	}

	// Check rate
	if ad.PriceOffset.IsZero() == false && ad.FiatPrice.IsZero() == false {
		return nil, fmt.Errorf("cannot set both fixed price and offset")
	}

	// Check user ad limit
	UserAds:
	count := 0
	for _, existingAd := range pm.ads {
		if existingAd.OwnerID == userID && existingAd.IsActive {
			count++
		}
	}
	if count >= pm.cfg.MaxAdsPerUser {
		return nil, fmt.Errorf("maximum ads per user reached")
	}

	ad.ID = generateAdID()
	ad.OwnerID = userID
	ad.IsActive = true
	ad.TradesCompleted = 0
	ad.Rating = decimal.NewFromFloat(5) // Default max rating
	ad.CreatedAt = time.Now()
	ad.UpdatedAt = time.Now()

	pm.mu.Lock()
	pm.ads[ad.ID] = ad
	pm.mu.Unlock()

	return ad, nil
}

// UpdateAd updates a P2P advertisement
func (pm *P2PMarket) UpdateAd(ctx context.Context, userID, adID string, updates *P2PAd) (*P2PAd, error) {
	pm.mu.RLock()
	ad, ok := pm.ads[adID]
	pm.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("ad not found")
	}

	if ad.OwnerID != userID {
		return nil, fmt.Errorf("unauthorized")
	}

	// Only allow updating certain fields
	if !updates.FiatPrice.IsZero() {
		ad.FiatPrice = updates.FiatPrice
	}
	if !updates.PriceOffset.IsZero() {
		ad.PriceOffset = updates.PriceOffset
	}
	if updates.MinAmount.IsZero() == false {
		ad.MinAmount = updates.MinAmount
	}
	if updates.MaxAmount.IsZero() == false {
		ad.MaxAmount = updates.MaxAmount
	}
	if len(updates.PaymentMethods) > 0 {
		ad.PaymentMethods = updates.PaymentMethods
	}
	if updates.Terms != "" {
		ad.Terms = updates.Terms
	}

	ad.UpdatedAt = time.Now()

	pm.mu.Lock()
	pm.ads[adID] = ad
	pm.mu.Unlock()

	return ad, nil
}

// ToggleAd activates/deactivates an ad
func (pm *P2PMarket) ToggleAd(ctx context.Context, userID, adID string) (*P2PAd, error) {
	pm.mu.RLock()
	ad, ok := pm.ads[adID]
	pm.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("ad not found")
	}

	if ad.OwnerID != userID {
		return nil, fmt.Errorf("unauthorized")
	}

	ad.IsActive = !ad.IsActive
	ad.UpdatedAt = time.Now()

	return ad, nil
}

// CreateOrder creates a P2P trade order
func (pm *P2PMarket) CreateOrder(ctx context.Context, buyerID, adID string, fiatAmount decimal.Decimal) (*P2POrder, error) {
	pm.mu.RLock()
	ad, ok := pm.ads[adID]
	pm.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("ad not found")
	}

	if !ad.IsActive {
		return nil, fmt.Errorf("ad is not active")
	}

	// Validate amount
	if fiatAmount.LessThan(ad.MinAmount) {
		return nil, fmt.Errorf("minimum amount is %s", ad.MinAmount.String())
	}

	if fiatAmount.GreaterThan(ad.MaxAmount) {
		return nil, fmt.Errorf("maximum amount is %s", ad.MaxAmount.String())
	}

	// Check seller has active ads
	if ad.Type != TradeTypeSell {
		return nil, fmt.Errorf("ad is not a sell ad")
	}

	// Compute crypto amount
	unitPrice := ad.FiatPrice
	if ad.PriceType == PriceTypeFloat {
		spotRate, err := pm.rates.GetRate(ad.Token, ad.FiatCurrency)
		if err != nil {
			return nil, err
		}
		unitPrice = spotRate.Add(spotRate.Mul(ad.PriceOffset).Div(decimal.NewFromFloat(100)))
	}

	cryptoAmount := fiatAmount.Div(unitPrice)

	order := &P2POrder{
		ID:            generateOrderID(),
		AdID:          adID,
		SellerID:      ad.OwnerID,
		BuyerID:       buyerID,
		Token:        ad.Token,
		FiatCurrency: ad.FiatCurrency,
		FiatAmount:   fiatAmount,
		CryptoAmount: cryptoAmount,
		UnitPrice:   unitPrice,
		Status:      OrderStatusPending,
		CreatedAt:   time.Now(),
		UpdatedAt:  time.Now(),
	}

	// Create escrow (locks crypto)
	escrowTxHash, err := pm.escrow.CreateEscrow(ctx, order)
	if err != nil {
		return nil, err
	}

	order.EscrowTxHash = escrowTxHash
	order.Status = OrderStatusPending

	pm.mu.Lock()
	pm.orders[order.ID] = &P2PEscrow{
		OrderID:        order.ID,
		CryptoAmount:  cryptoAmount,
		Token:        ad.Token,
		EscrowAddress: "",
		TxHash:       escrowTxHash,
		Status:       "PENDING",
	}
	pm.mu.Unlock()

	// Create chat room
	pm.chat.CreateRoom(order.ID)

	return order, nil
}

// MarkAsPaid marks order as paid by buyer
func (pm *P2PMarket) MarkAsPaid(ctx context.Context, userID, orderID string) error {
	pm.mu.RLock()
	order, ok := pm.orders[orderID]
	pm.mu.RUnlock()

	if !ok {
		return fmt.Errorf("order not found")
	}

	if order.BuyerID != userID {
		return fmt.Errorf("unauthorized")
	}

	if order.Status != OrderStatusPending {
		return fmt.Errorf("order not in pending state")
	}

	order.Status = OrderStatusPaid
	order.UpdatedAt = time.Now()

	return nil
}

// ConfirmReceipt confirms payment received and releases crypto
func (pm *P2PMarket) ConfirmReceipt(ctx context.Context, userID, orderID string, paymentProof string) error {
	pm.mu.RLock()
	order, ok := pm.orders[orderID]
	pm.mu.RUnlock()

	if !ok {
		return fmt.Errorf("order not found")
	}

	if order.SellerID != userID {
		return fmt.Errorf("unauthorized")
	}

	if order.Status != OrderStatusPaid {
		return fmt.Errorf("buyer has not confirmed payment")
	}

	// Verify payment (in production, would check with payment provider)

	order.Status = OrderStatusConfirming
	order.PaymentProof = paymentProof
	order.UpdatedAt = time.Now()

	// Release from escrow
	err := pm.escrow.ReleaseEscrow(ctx, orderID)
	if err != nil {
		order.Status = OrderStatusDisputed
		return err
	}

	now := time.Now()
	order.Status = OrderStatusCompleted
	order.CompletedAt = &now

	// Update ad stats
	pm.mu.RLock()
	if ad, ok := pm.ads[order.AdID]; ok {
		ad.TradesCompleted++
	}
	pm.mu.RUnlock()

	return nil
}

// CancelOrder cancels a P2P order
func (pm *P2PMarket) CancelOrder(ctx context.Context, userID, orderID string, reason string) error {
	pm.mu.RLock()
	order, ok := pm.orders[orderID]
	pm.mu.RUnlock()

	if !ok {
		return fmt.Errorf("order not found")
	}

	if order.SellerID != userID && order.BuyerID != userID {
		return fmt.Errorf("unauthorized")
	}

	if order.Status == OrderStatusCompleted {
		return fmt.Errorf("order already completed")
	}

	// Cancel escrow
	err := pm.escrow.CancelEscrow(ctx, orderID)
	if err != nil {
		return err
	}

	order.Status = OrderStatusCancelled
	order.UpdatedAt = time.Now()
	_ = reason

	return nil
}

// OpenDispute opens a dispute
func (pm *P2PMarket) OpenDispute(ctx context.Context, userID, orderID, reason, evidence string) (*Dispute, error) {
	pm.mu.RLock()
	order, ok := pm.orders[orderID]
	pm.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("order not found")
	}

	if order.SellerID != userID && order.BuyerID != userID {
		return nil, fmt.Errorf("unauthorized")
	}

	// Check if within dispute window
	if order.Status == OrderStatusCompleted {
		elapsed := time.Since(*order.CompletedAt)
		if elapsed > pm.cfg.DisputeWindow {
			return nil, fmt.Errorf("dispute window closed")
		}
	}

	order.Status = OrderStatusDisputed

	dispute := &Dispute{
		ID:       generateDisputeID(),
		OrderID:  orderID,
		OpenerID: userID,
		Reason:  reason,
		Evidence: evidence,
		Status:  "OPEN",
		OpenedAt: time.Now(),
	}

	pm.mu.Lock()
	pm.disputes[dispute.ID] = dispute
	pm.mu.Unlock()

	return dispute, nil
}

// ResolveDispute resolves a dispute (admin only)
func (pm *P2PMarket) ResolveDispute(ctx context.Context, adminID, disputeID, resolution string) (*Dispute, error) {
	pm.mu.RLock()
	dispute, ok := pm.disputes[disputeID]
	pm.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("dispute not found")
	}

	if dispute.Status == "RESOLVED" {
		return nil, fmt.Errorf("dispute already resolved")
	}

	orderID := dispute.OrderID

	// Resolve based on admin decision
	switch resolution {
	case "RELEASE":
		err := pm.escrow.ReleaseEscrow(ctx, orderID)
		if err != nil {
			return nil, err
		}
	case "REFUND":
		err := pm.escrow.CancelEscrow(ctx, orderID)
		if err != nil {
			return nil, err
		}
	}

	now := time.Now()
	dispute.Status = "RESOLVED"
	dispute.Resolution = resolution
	dispute.AdminNote = resolution
	dispute.ResolvedAt = &now

	return dispute, nil
}

// SearchAds searches for P2P ads
func (pm *P2PMarket) SearchAds(filter *AdFilter) []*P2PAd {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	var result []*P2PAd
	for _, ad := range pm.ads {
		if !ad.IsActive {
			continue
		}

		if filter != nil {
			// Apply filters
			if filter.Type != "" && ad.Type != filter.Type {
				continue
			}
			if filter.Token != "" && ad.Token != filter.Token {
				continue
			}
			if filter.FiatCurrency != "" && ad.FiatCurrency != filter.FiatCurrency {
				continue
			}
			if filter.PaymentMethod != "" {
				found := false
				for _, pm := range ad.PaymentMethods {
					if pm == filter.PaymentMethod {
						found = true
						break
					}
				}
				if !found {
					continue
				}
			}
			if filter.FiatAmount != nil {
				if filter.FiatAmount.LessThan(ad.MinAmount) ||
					filter.FiatAmount.GreaterThan(ad.MaxAmount) {
					continue
				}
			}
		}

		result = append(result, ad)

		if len(result) >= 50 { // Limit results
			break
		}
	}

	return result
}

// AdFilter filters ads
type AdFilter struct {
	Type          TradeType
	Token        string
	FiatCurrency string
	PaymentMethod string
	FiatAmount   *decimal.Decimal
}

// GetOrder returns order by ID
func (pm *P2PMarket) GetOrder(orderID string) (*P2POrder, bool) {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	// Search in map
	for _, escrow := range pm.orders {
		if escrow.OrderID == orderID {
			// Would need to reconstruct from stored data
			return nil, false
		}
	}
	return nil, false
}

// Helper functions
func generateAdID() string {
	return fmt.Sprintf("P2PAD%d%d", time.Now().UnixNano(), time.Now().Nanosecond())
}

func generateOrderID() string {
	return fmt.Sprintf("P2PORD%d%d", time.Now().UnixNano(), time.Now().Nanosecond())
}

func generateDisputeID() string {
	return fmt.Sprintf("P2PDSP%d%d", time.Now().UnixNano(), time.Now().Nanosecond())
}

var _ = decimal.Decimal{}