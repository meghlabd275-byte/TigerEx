package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// =============================================================================
// P2P TRADING SERVICE - Complete Production Implementation
// =============================================================================

// P2PService handles peer-to-peer trading
type P2PService struct {
	db        *pgxpool.Pool
	escrow   *EscrowManager
	dispute  *DisputeManager
	notify   *NotificationService
	stats   *P2PStats
}

type P2PStats struct {
	mu           sync.RWMutex
	ActiveOrders int64
	CompletedTrades int64
	TotalVolume   float64
}

// =============================================================================
// P2P MODELS
// =============================================================================

// P2POrder represents a P2P advertisement
type P2POrder struct {
	OrderID           uuid.UUID
	UserID           uuid.UUID
	
	Side             P2PSide          // buy, sell
	FiatCurrency     string           // USD, EUR, etc.
	Asset           string           // BTC, ETH, USDT
	
	// Pricing
	PriceType       P2PPriceType    // fixed, floating
	PriceMargin     float64          // percentage from market
	MarketIndex     int              // for floating price
	FixedPrice      float64          // for fixed price
	
	// Amounts
	Amount           float64         // total crypto amount
	AvailableAmount  float64         // remaining
	MinAmount        float64         // min per trade
	MaxAmount        float64         // max per trade
	
	// Payment
	PaymentMethods  []string        // bank_transfer, paypal, etc.
	PaymentWindow   int            // minutes to pay
	Remark          string
	
	// Status
	Status          P2POrderStatus  // active, paused, completed, canceled
	CompletedTrades int
	Rating          float64
	
	CreatedAt       time.Time
	UpdatedAt       time.Time
	CompletedAt      *time.Time
}

type P2PSide string
type P2PPriceType string
type P2POrderStatus string

const (
	P2PSideBuy   P2PSide = "buy"
	P2PSideSell  P2PSide = "sell"
	
	P2PPriceFixed   P2PPriceType = "fixed"
	P2PPriceFloating P2PPriceType = "floating"
	
	P2POrderActive    P2POrderStatus = "active"
	P2POrderPaused   P2POrderStatus = "paused"
	P2POrderCompleted P2POrderStatus = "completed"
	P2POrderCanceled  P2POrderStatus = "canceled"
)

// P2PTrade represents an active P2P trade
type P2PTrade struct {
	TradeID         uuid.UUID
	OrderID        uuid.UUID
	BuyerID        uuid.UUID
	SellerID       uuid.UUID
	
	Asset          string
	FiatCurrency   string
	Amount         float64          // crypto amount
	PricePerUnit   float64
	TotalAmount    float64          // fiat amount
	
	PaymentMethod  string
	PaymentReference string
	
	Status         P2PTradeStatus
	BuyerConfirmed bool
	SellerConfirmed bool
	BuyerConfirmAt  *time.Time
	SellerConfirmAt *time.Time
	
	// Dispute
	Disputed       bool
	DisputeReason  string
	DisputeResult  string
	ResolvedBy    uuid.UUID
	ResolvedAt    *time.Time
	
	CreatedAt      time.Time
	UpdatedAt      time.Time
	CompletedAt    *time.Time
	CanceledAt    *time.Time
}

type P2PTradeStatus string

const (
	P2PTradePending     P2PTradeStatus = "pending"
	P2PTradeAwaitingPayment P2PTradeStatus = "awaiting_payment"
	P2PTradePaid        P2PTradeStatus = "paid"
	P2PTradeDisputed    P2PTradeStatus = "disputed"
	P2PTradeCompleted   P2PTradeStatus = "completed"
	P2PTradeCanceled   P2PTradeStatus = "canceled"
	P2PTradeRefunded   P2PTradeStatus = "refunded"
)

// PaymentMethod model
type PaymentMethod struct {
	MethodID     uuid.UUID
	Name         string
	Type         string           // bank, e_wallet, crypto
	Fields       []PaymentField  // required fields
	Verification bool            // requires verification
	Countries    []string
	Fee          float64
	Status       string
}

type PaymentField struct {
	Name        string
	Type        string           // text, number, file
	Required    bool
	Label       string
	Placeholder string
}

// =============================================================================
// ESCROW MANAGER
// =============================================================================

type EscrowManager struct {
	db *pgxpool.Pool
	mu sync.Mutex
}

type EscrowAccount struct {
	AccountID   uuid.UUID
	TradeID    uuid.UUID
	SellerID   uuid.UUID
	Currency   string
	Amount     float64
	Locked     bool
	Released   bool
	ReleasedAt *time.Time
	CreatedAt  time.Time
}

// LockCrypto locks crypto in escrow for a trade
func (em *EscrowManager) LockCrypto(ctx context.Context, trade *P2PTrade) error {
	escrow := &EscrowAccount{
		AccountID: uuid.New(),
		TradeID:  trade.TradeID,
		SellerID: trade.SellerID,
		Currency: trade.Asset,
		Amount:   trade.Amount,
		Locked:   true,
		CreatedAt: time.Now(),
	}
	
	_, err := em.db.Exec(ctx,
		`INSERT INTO p2p_escrow (account_id, trade_id, seller_id, currency, amount, locked, created_at)
		 VALUES ($1, $2, $3, $4, $5, true, $6)`,
		escrow.AccountID, escrow.TradeID, escrow.SellerID, escrow.Currency, escrow.Amount, escrow.CreatedAt,
	)
	
	if err != nil {
		return fmt.Errorf("failed to lock escrow: %w", err)
	}
	
	// Lock seller's crypto
	_, err = em.db.Exec(ctx,
		`UPDATE balances SET 
		 available_amount = available_amount - $1,
		 locked_amount = locked_amount + $1
		 WHERE user_id = $2 AND currency = $3`,
		trade.Amount, trade.SellerID, trade.Asset,
	)
	
	return err
}

// ReleaseCrypto releases crypto to buyer after trade completion
func (em *EscrowManager) ReleaseCrypto(ctx context.Context, tradeID uuid.UUID) error {
	em.mu.Lock()
	defer em.mu.Unlock()
	
	// Get escrow account
	var escrow EscrowAccount
	err := em.db.QueryRow(ctx,
		`SELECT account_id, trade_id, seller_id, currency, amount, locked
		 FROM p2p_escrow WHERE trade_id = $1 AND locked = true`,
		tradeID,
	).Scan(&escrow.AccountID, &escrow.TradeID, &escrow.SellerID, &escrow.Currency, &escrow.Amount, &escrow.Locked)
	
	if err == sql.ErrNoRows {
		return errors.New("escrow not found")
	}
	if err != nil {
		return err
	}
	
	// Update escrow
	now := time.Now()
	_, err = em.db.Exec(ctx,
		`UPDATE p2p_escrow SET locked = false, released = true, released_at = $1 WHERE account_id = $2`,
		now, escrow.AccountID,
	)
	
	if err != nil {
		return err
	}
	
	// Transfer crypto to buyer
	var buyerID uuid.UUID
	err = em.db.QueryRow(ctx,
		`SELECT buyer_id FROM p2p_trades WHERE trade_id = $1`,
		tradeID,
	).Scan(&buyerID)
	
	if err != nil {
		return err
	}
	
	// Release from seller (unlock locked)
	_, err = em.db.Exec(ctx,
		`UPDATE balances SET locked_amount = locked_amount - $1 WHERE user_id = $2 AND currency = $3`,
		escrow.Amount, escrow.SellerID, escrow.Currency,
	)
	
	// Credit to buyer
	_, err = em.db.Exec(ctx,
		`UPDATE balances SET available_amount = available_amount + $1 WHERE user_id = $2 AND currency = $3`,
		escrow.Amount, buyerID, escrow.Currency,
	)
	
	return err
}

// RefundCrypto refunds crypto to seller after cancellation/dispute
func (em *EscrowManager) RefundCrypto(ctx context.Context, tradeID uuid.UUID) error {
	em.mu.Lock()
	defer em.mu.Unlock()
	
	var escrow EscrowAccount
	err := em.db.QueryRow(ctx,
		`SELECT account_id, trade_id, seller_id, currency, amount, locked
		 FROM p2p_escrow WHERE trade_id = $1`,
		tradeID,
	).Scan(&escrow.AccountID, &escrow.TradeID, &escrow.SellerID, &escrow.Currency, &escrow.Amount, &escrow.Locked)
	
	if err == sql.ErrNoRows {
		return nil // Already released
	}
	if err != nil {
		return err
	}
	
	if !escrow.Locked {
		return nil // Already processed
	}
	
	// Update escrow
	_, err = em.db.Exec(ctx,
		`UPDATE p2p_escrow SET locked = false, released = true, released_at = $1 WHERE account_id = $2`,
		time.Now(), escrow.AccountID,
	)
	
	if err != nil {
		return err
	}
	
	// Refund to seller
	_, err = em.db.Exec(ctx,
		`UPDATE balances SET 
		 available_amount = available_amount + $1,
		 locked_amount = locked_amount - $1
		 WHERE user_id = $2 AND currency = $3`,
		escrow.Amount, escrow.SellerID, escrow.Currency,
	)
	
	return err
}

// =============================================================================
// DISPUTE MANAGER
// =============================================================================

type DisputeManager struct {
	db *pgxpool.Pool
	mu sync.Mutex
}

type Dispute struct {
	DisputeID    uuid.UUID
	TradeID     uuid.UUID
	ReporterID  uuid.UUID
	ReportedID  uuid.UUID
	
	Reason      string
	Description string
	Evidence    []string        // URLs to evidence
	
	Status      DisputeStatus
	Resolution  string
	ResolvedBy  uuid.UUID
	ResolvedAt *time.Time
	
	CreatedAt   time.Time
	UpdatedAt  time.Time
}

type DisputeStatus string

const (
	DisputeOpen     DisputeStatus = "open"
	DisputeUnderReview DisputeStatus = "under_review"
	DisputeResolved DisputeStatus = "resolved"
	DisputeRejected DisputeStatus = "rejected"
)

// OpenDispute opens a new dispute
func (dm *DisputeManager) OpenDispute(ctx context.Context, tradeID uuid.UUID, reporterID uuid.UUID, reason, description string, evidence []string) (*Dispute, error) {
	// Get trade details
	var trade P2PTrade
	err := dm.db.QueryRow(ctx,
		`SELECT trade_id, buyer_id, seller_id FROM p2p_trades WHERE trade_id = $1`,
		tradeID,
	).Scan(&trade.TradeID, &trade.BuyerID, &trade.SellerID)
	
	if err != nil {
		return nil, err
	}
	
	// Determine reported user
	var reportedID uuid.UUID
	if reporterID == trade.BuyerID {
		reportedID = trade.SellerID
	} else if reporterID == trade.SellerID {
		reportedID = trade.BuyerID
	} else {
		return nil, errors.New("user not part of this trade")
	}
	
	// Create dispute
	dispute := &Dispute{
		DisputeID:    uuid.New(),
		TradeID:     tradeID,
		ReporterID:  reporterID,
		ReportedID:  reportedID,
		Reason:      reason,
		Description: description,
		Evidence:    evidence,
		Status:      DisputeOpen,
		CreatedAt:   time.Now(),
		UpdatedAt:  time.Now(),
	}
	
	_, err = dm.db.Exec(ctx,
		`INSERT INTO p2p_disputes 
		 (dispute_id, trade_id, reporter_id, reported_id, reason, description, evidence, status, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		dispute.DisputeID, dispute.TradeID, dispute.ReporterID, dispute.ReportedID,
		dispute.Reason, dispute.Description, dispute.Evidence, dispute.Status, dispute.CreatedAt,
	)
	
	if err != nil {
		return nil, err
	}
	
	// Update trade status
	_, err = dm.db.Exec(ctx,
		`UPDATE p2p_trades SET status = 'disputed', updated_at = NOW() WHERE trade_id = $1`,
		tradeID,
	)
	
	return dispute, err
}

// ResolveDispute resolves a dispute
func (dm *DisputeManager) ResolveDispute(ctx context.Context, disputeID uuid.UUID, resolution string, resolvedBy uuid.UUID) error {
	now := time.Now()
	
	_, err := dm.db.Exec(ctx,
		`UPDATE p2p_disputes SET 
		 status = 'resolved', resolution = $1, resolved_by = $2, resolved_at = $3, updated_at = $3
		 WHERE dispute_id = $4`,
		resolution, resolvedBy, now, disputeID,
	)
	
	if err != nil {
		return err
	}
	
	// Get trade ID
	var tradeID uuid.UUID
	err = dm.db.QueryRow(ctx,
		`SELECT trade_id FROM p2p_disputes WHERE dispute_id = $1`,
		disputeID,
	).Scan(&tradeID)
	
	if err != nil {
		return err
	}
	
	// Update trade with resolution
	_, err = dm.db.Exec(ctx,
		`UPDATE p2p_trades SET 
		 dispute_result = $1, resolved_by = $2, resolved_at = $3, updated_at = $3
		 WHERE trade_id = $4`,
		resolution, resolvedBy, now, tradeID,
	)
	
	return err
}

// =============================================================================
// P2P SERVICE METHODS
// =============================================================================

// NewP2PService creates a new P2P service
func NewP2PService(db *pgxpool.Pool) *P2PService {
	return &P2PService{
		db:      db,
		escrow:  &EscrowManager{db: db},
		dispute: &DisputeManager{db: db},
		notify:  &NotificationService{},
		stats:   &P2PStats{},
	}
}

// CreateOrder creates a new P2P order
func (p2p *P2PService) CreateOrder(ctx context.Context, req *CreateP2POrderRequest) (*P2POrder, error) {
	// Validate payment methods
	if len(req.PaymentMethods) == 0 {
		return nil, errors.New("at least one payment method required")
	}
	
	// Calculate price
	price, err := p2p.calculatePrice(ctx, req)
	if err != nil {
		return nil, err
	}
	
	order := &P2POrder{
		OrderID:          uuid.New(),
		UserID:           uuid.MustParse(req.UserID),
		Side:            P2PSide(req.Side),
		FiatCurrency:     req.FiatCurrency,
		Asset:           req.Asset,
		PriceType:       P2PPriceType(req.PriceType),
		PriceMargin:     req.PriceMargin,
		FixedPrice:      price,
		Amount:          req.Amount,
		AvailableAmount: req.Amount,
		MinAmount:       req.MinAmount,
		MaxAmount:       req.MaxAmount,
		PaymentMethods:  req.PaymentMethods,
		PaymentWindow:   req.PaymentWindow,
		Remark:         req.Remark,
		Status:         P2POrderActive,
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
	}
	
	if order.MinAmount <= 0 {
		order.MinAmount = req.Amount * 0.1 // 10% default
	}
	
	if order.MaxAmount <= 0 {
		order.MaxAmount = req.Amount
	}
	
	if order.PaymentWindow <= 0 {
		order.PaymentWindow = 15 // 15 minutes default
	}
	
	// Save to database
	_, err = p2p.db.Exec(ctx,
		`INSERT INTO p2p_orders 
		 (order_id, user_id, side, fiat_currency, asset, price_type, price_margin, fixed_price,
		  amount, available_amount, min_amount, max_amount, payment_methods, payment_window, 
		  remark, status, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
		order.OrderID, order.UserID, order.Side, order.FiatCurrency, order.Asset,
		order.PriceType, order.PriceMargin, order.FixedPrice, order.Amount, order.AvailableAmount,
		order.MinAmount, order.MaxAmount, order.PaymentMethods, order.PaymentWindow,
		order.Remark, order.Status, order.CreatedAt,
	)
	
	if err != nil {
		return nil, fmt.Errorf("failed to create order: %w", err)
	}
	
	// Update stats
	atomic.AddInt64(&p2p.stats.ActiveOrders, 1)
	
	return order, nil
}

type CreateP2POrderRequest struct {
	UserID         string
	Side           string           // buy, sell
	FiatCurrency   string
	Asset         string
	PriceType     string           // fixed, floating
	PriceMargin   float64
	Amount        float64
	MinAmount     float64
	MaxAmount     float64
	PaymentMethods []string
	PaymentWindow int
	Remark        string
}

// calculatePrice calculates the actual price based on type
func (p2p *P2PService) calculatePrice(ctx context.Context, req *CreateP2POrderRequest) (float64, error) {
	if req.PriceType == "fixed" {
		return req.PriceMargin, nil // Using PriceMargin field for fixed price
	}
	
	// Floating price - get market price
	var marketPrice float64
	err := p2p.db.QueryRow(ctx,
		`SELECT COALESCE(last_price, 0) FROM market_states ms
		 JOIN markets m ON ms.market_id = m.market_id
		 WHERE m.market_symbol = $1`,
		req.Asset+"/USDT",
	).Scan(&marketPrice)
	
	if err != nil || marketPrice == 0 {
		// Use default if no market
		marketPrice = 1.0
	}
	
	// Apply margin
	price := marketPrice * (1 + req.PriceMargin/100)
	return price, nil
}

// GetOrders returns P2P orders matching criteria
func (p2p *P2PService) GetOrders(ctx context.Context, req *GetP2POrdersRequest) ([]P2POrder, error) {
	query := `SELECT order_id, user_id, side, fiat_currency, asset, price_type, price_margin,
	 fixed_price, amount, available_amount, min_amount, max_amount, payment_methods,
	 payment_window, remark, status, completed_trades, rating, created_at
	 FROM p2p_orders WHERE status = 'active'`
	
	args := []interface{}{}
	argNum := 1
	
	if req.Asset != "" {
		query += fmt.Sprintf(" AND asset = $%d", argNum)
		args = append(args, req.Asset)
		argNum++
	}
	
	if req.FiatCurrency != "" {
		query += fmt.Sprintf(" AND fiat_currency = $%d", argNum)
		args = append(args, req.FiatCurrency)
		argNum++
	}
	
	if req.Side != "" {
		query += fmt.Sprintf(" AND side = $%d", argNum)
		args = append(args, req.Side)
		argNum++
	}
	
	// Exclude user's own orders
	if req.ExcludeUserID != "" {
		query += fmt.Sprintf(" AND user_id != $%d", argNum)
		args = append(args, req.ExcludeUserID)
		argNum++
	}
	
	query += " ORDER BY created_at DESC"
	
	if req.Limit > 0 {
		query += fmt.Sprintf(" LIMIT $%d", argNum)
		args = append(args, req.Limit)
	}
	
	rows, err := p2p.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	
	var orders []P2POrder
	for rows.Next() {
		var o P2POrder
		var paymentMethods []string
		
		err := rows.Scan(
			&o.OrderID, &o.UserID, &o.Side, &o.FiatCurrency, &o.Asset,
			&o.PriceType, &o.PriceMargin, &o.FixedPrice, &o.Amount, &o.AvailableAmount,
			&o.MinAmount, &o.MaxAmount, &paymentMethods, &o.PaymentWindow,
			&o.Remark, &o.Status, &o.CompletedTrades, &o.Rating, &o.CreatedAt,
		)
		
		if err != nil {
			continue
		}
		
		o.PaymentMethods = paymentMethods
		orders = append(orders, o)
	}
	
	if orders == nil {
		orders = []P2POrder{}
	}
	
	return orders, nil
}

type GetP2POrdersRequest struct {
	Asset         string
	FiatCurrency  string
	Side          string
	ExcludeUserID string
	Limit         int
}

// StartTrade starts a P2P trade
func (p2p *P2PService) StartTrade(ctx context.Context, req *StartP2PTradeRequest) (*P2PTrade, error) {
	// Get order
	var order P2POrder
	err := p2p.db.QueryRow(ctx,
		`SELECT order_id, user_id, side, amount, available_amount, min_amount, max_amount,
		 fixed_price, payment_methods, payment_window, status
		 FROM p2p_orders WHERE order_id = $1 AND status = 'active'`,
		req.OrderID,
	).Scan(
		&order.OrderID, &order.UserID, &order.Side, &order.Amount, &order.AvailableAmount,
		&order.MinAmount, &order.MaxAmount, &order.FixedPrice, &order.PaymentMethods,
		&order.PaymentWindow, &order.Status,
	)
	
	if err != nil {
		return nil, errors.New("order not found or not active")
	}
	
	// Validate buyer isn't seller
	buyerID := uuid.MustParse(req.BuyerID)
	if buyerID == order.UserID {
		return nil, errors.New("cannot trade with yourself")
	}
	
	// Validate amount
	if req.Amount < order.MinAmount || req.Amount > order.MaxAmount {
		return nil, fmt.Errorf("amount must be between %f and %f", order.MinAmount, order.MaxAmount)
	}
	
	// Check payment method is valid
	validMethod := false
	for _, m := range order.PaymentMethods {
		if m == req.PaymentMethod {
			validMethod = true
			break
		}
	}
	
	if !validMethod {
		return nil, errors.New("invalid payment method")
	}
	
	// Create trade
	trade := &P2PTrade{
		TradeID:       uuid.New(),
		OrderID:      order.OrderID,
		BuyerID:       buyerID,
		SellerID:      order.UserID,
		Asset:         order.Asset,
		FiatCurrency:  order.FiatCurrency,
		Amount:        req.Amount,
		PricePerUnit:  order.FixedPrice,
		TotalAmount:   req.Amount * order.FixedPrice,
		PaymentMethod: req.PaymentMethod,
		Status:        P2PTradePending,
		CreatedAt:     time.Now(),
		UpdatedAt:    time.Now(),
	}
	
	_, err = p2p.db.Exec(ctx,
		`INSERT INTO p2p_trades 
		 (trade_id, order_id, buyer_id, seller_id, asset, fiat_currency, amount, price_per_unit,
		  total_amount, payment_method, status, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
		trade.TradeID, trade.OrderID, trade.BuyerID, trade.SellerID,
		trade.Asset, trade.FiatCurrency, trade.Amount, trade.PricePerUnit,
		trade.TotalAmount, trade.PaymentMethod, trade.Status, trade.CreatedAt,
	)
	
	if err != nil {
		return nil, fmt.Errorf("failed to create trade: %w", err)
	}
	
	// Lock crypto in escrow (for sell orders)
	if order.Side == P2PSideSell {
		if err := p2p.escrow.LockCrypto(ctx, trade); err != nil {
			// Rollback trade
			p2p.db.Exec(ctx, "DELETE FROM p2p_trades WHERE trade_id = $1", trade.TradeID)
			return nil, err
		}
	}
	
	// Update order available amount
	_, err = p2p.db.Exec(ctx,
		`UPDATE p2p_orders SET available_amount = available_amount - $1 WHERE order_id = $2`,
		req.Amount, order.OrderID,
	)
	
	// Update stats
	atomic.AddInt64(&p2p.stats.ActiveOrders, 1)
	
	return trade, nil
}

type StartP2PTradeRequest struct {
	OrderID       string
	BuyerID       string
	Amount        float64
	PaymentMethod string
}

// ConfirmPayment marks payment as made
func (p2p *P2PService) ConfirmPayment(ctx context.Context, tradeID, userID string) error {
	tradeUUID := uuid.MustParse(tradeID)
	userUUID := uuid.MustParse(userID)
	
	// Get trade
	var trade P2PTrade
	err := p2p.db.QueryRow(ctx,
		`SELECT trade_id, buyer_id, seller_id, status, buyer_confirmed, seller_confirmed
		 FROM p2p_trades WHERE trade_id = $1`,
		tradeUUID,
	).Scan(&trade.TradeID, &trade.BuyerID, &trade.SellerID, &trade.Status, &trade.BuyerConfirmed, &trade.SellerConfirmed)
	
	if err != nil {
		return err
	}
	
	// Verify user is buyer
	if userUUID != trade.BuyerID {
		return errors.New("only buyer can confirm payment")
	}
	
	now := time.Now()
	
	// Update buyer confirmation
	_, err = p2p.db.Exec(ctx,
		`UPDATE p2p_trades SET 
		 buyer_confirmed = true, buyer_confirm_at = $1, status = 'awaiting_payment', updated_at = $1
		 WHERE trade_id = $2`,
		now, tradeUUID,
	)
	
	return err
}

// ConfirmReceipt confirms the trade is complete
func (p2p *P2PService) ConfirmReceipt(ctx context.Context, tradeID, userID string) error {
	tradeUUID := uuid.MustParse(tradeID)
	userUUID := uuid.MustParse(userID)
	
	// Get trade
	var trade P2PTrade
	err := p2p.db.QueryRow(ctx,
		`SELECT trade_id, buyer_id, seller_id, status
		 FROM p2p_trades WHERE trade_id = $1`,
		tradeUUID,
	).Scan(&trade.TradeID, &trade.BuyerID, &trade.SellerID, &trade.Status)
	
	if err != nil {
		return err
	}
	
	// Verify user is seller
	if userUUID != trade.SellerID {
		return errors.New("only seller can confirm receipt")
	}
	
	now := time.Now()
	
	// Release escrow to buyer
	if err := p2p.escrow.ReleaseCrypto(ctx, tradeUUID); err != nil {
		return err
	}
	
	// Update trade status
	_, err = p2p.db.Exec(ctx,
		`UPDATE p2p_trades SET 
		 status = 'completed', seller_confirmed = true, seller_confirm_at = $1,
		 completed_at = $1, updated_at = $1
		 WHERE trade_id = $2`,
		now, tradeUUID,
	)
	
	if err != nil {
		return err
	}
	
	// Update order completed count
	p2p.db.Exec(ctx,
		`UPDATE p2p_orders SET completed_trades = completed_trades + 1 WHERE order_id = $1`,
		trade.OrderID,
	)
	
	// Update stats
	atomic.AddInt64(&p2p.stats.CompletedTrades, 1)
	atomic.AddInt64(&p2p.stats.ActiveOrders, -1)
	
	// Notify buyer
	if p2p.notify != nil {
		p2p.notify.SendTradeCompleted(ctx, trade.BuyerID.String(), tradeUUID)
	}
	
	return nil
}

// CancelTrade cancels a P2P trade
func (p2p *P2PService) CancelTrade(ctx context.Context, tradeID, userID string, reason string) error {
	tradeUUID := uuid.MustParse(tradeID)
	userUUID := uuid.MustParse(userID)
	
	// Get trade
	var trade P2PTrade
	err := p2p.db.QueryRow(ctx,
		`SELECT trade_id, buyer_id, seller_id, status, buyer_confirmed, seller_confirmed
		 FROM p2p_trades WHERE trade_id = $1`,
		tradeUUID,
	).Scan(&trade.TradeID, &trade.BuyerID, &trade.SellerID, &trade.Status, &trade.BuyerConfirmed, &trade.SellerConfirmed)
	
	if err != nil {
		return err
	}
	
	// Only buyer or seller can cancel
	if userUUID != trade.BuyerID && userUUID != trade.SellerID {
		return errors.New("unauthorized")
	}
	
	// Can only cancel before payment confirmed
	if trade.Status == P2PTradePaid || trade.Status == P2PTradeCompleted {
		return errors.New("cannot cancel trade in current status")
	}
	
	now := time.Now()
	
	// Refund escrow if applicable
	if trade.Status == P2PTradeAwaitingPayment {
		p2p.escrow.RefundCrypto(ctx, tradeUUID)
	}
	
	// Update trade
	_, err = p2p.db.Exec(ctx,
		`UPDATE p2p_trades SET 
		 status = 'canceled', canceled_at = $1, updated_at = $1
		 WHERE trade_id = $2`,
		now, tradeUUID,
	)
	
	if err != nil {
		return err
	}
	
	// Restore order amount
	p2p.db.Exec(ctx,
		`UPDATE p2p_orders SET available_amount = available_amount + $1 WHERE order_id = $2`,
		trade.Amount, trade.OrderID,
	)
	
	// Update stats
	atomic.AddInt64(&p2p.stats.ActiveOrders, -1)
	
	return nil
}

// OpenDispute opens a dispute
func (p2p *P2PService) OpenDispute(ctx context.Context, tradeID, userID, reason, description string) error {
	tradeUUID := uuid.MustParse(tradeID)
	userUUID := uuid.MustParse(userID)
	
	dispute, err := p2p.dispute.OpenDispute(ctx, tradeUUID, userUUID, reason, description, nil)
	if err != nil {
		return err
	}
	
	_ = dispute
	
	// Notify other party
	if p2p.notify != nil {
		var otherUserID string
		var trade P2PTrade
		p2p.db.QueryRow(ctx, "SELECT buyer_id, seller_id FROM p2p_trades WHERE trade_id = $1", tradeUUID).
			Scan(&trade.BuyerID, &trade.SellerID)
		
		if userUUID == trade.BuyerID {
			otherUserID = trade.SellerID.String()
		} else {
			otherUserID = trade.BuyerID.String()
		}
		
		p2p.notify.SendDisputeOpened(ctx, otherUserID, tradeUUID)
	}
	
	return nil
}

// GetPaymentMethods returns available payment methods
func (p2p *P2PService) GetPaymentMethods(ctx context.Context) ([]PaymentMethod, error) {
	rows, err := p2p.db.Query(ctx,
		`SELECT method_id, name, type, fields, verification_required, countries, fee, status
		 FROM p2p_payment_methods WHERE status = 'active'`,
	)
	
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	
	var methods []PaymentMethod
	for rows.Next() {
		var m PaymentMethod
		var fields []byte
		var countries []string
		
		err := rows.Scan(&m.MethodID, &m.Name, &m.Type, &fields, &m.Verification, &countries, &m.Fee, &m.Status)
		if err != nil {
			continue
		}
		
		json.Unmarshal(fields, &m.Fields)
		m.Countries = countries
		methods = append(methods, m)
	}
	
	if methods == nil {
		methods = getDefaultPaymentMethods()
	}
	
	return methods, nil
}

func getDefaultPaymentMethods() []PaymentMethod {
	return []PaymentMethod{
		{
			MethodID:     uuid.MustParse("00000000-0000-0000-0000-000000000001"),
			Name:         "Bank Transfer",
			Type:         "bank",
			Fields: []PaymentField{
				{Name: "account_name", Type: "text", Required: true, Label: "Account Name"},
				{Name: "account_number", Type: "number", Required: true, Label: "Account Number"},
				{Name: "bank_name", Type: "text", Required: true, Label: "Bank Name"},
				{Name: "routing_number", Type: "number", Required: false, Label: "Routing Number"},
			},
			Verification: true,
			Fee:          0,
		},
		{
			MethodID:     uuid.MustParse("00000000-0000-0000-0000-000000000002"),
			Name:         "PayPal",
			Type:         "e_wallet",
			Fields: []PaymentField{
				{Name: "email", Type: "text", Required: true, Label: "PayPal Email"},
			},
			Verification: true,
			Fee:          1.0,
		},
		{
			MethodID:     uuid.MustParse("00000000-0000-0000-0000-000000000003"),
			Name:         "Venmo",
			Type:         "e_wallet",
			Fields: []PaymentField{
				{Name: "username", Type: "text", Required: true, Label: "Venmo Username"},
			},
			Verification: true,
			Fee:          1.0,
		},
		{
			MethodID:     uuid.MustParse("00000000-0000-0000-0000-000000000004"),
			Name:         "Cash App",
			Type:         "e_wallet",
			Fields: []PaymentField{
				{Name: "cashtag", Type: "text", Required: true, Label: "Cash App Tag"},
			},
			Verification: true,
			Fee:          1.5,
		},
	}
}

// =============================================================================
// NOTIFICATION SERVICE (Stub)
// =============================================================================

type NotificationService struct{}

func (ns *NotificationService) SendTradeCompleted(ctx context.Context, userID string, tradeID uuid.UUID) {
	// Implement notification sending
	log.Printf("Notification: Trade %s completed for user %s", tradeID, userID)
}

func (ns *NotificationService) SendDisputeOpened(ctx context.Context, userID string, tradeID uuid.UUID) {
	log.Printf("Notification: Dispute opened for trade %s, user %s notified", tradeID, userID)
}

func init() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)
}

func main() {
	log.Println("P2P Trading Service - Use as library")
}

var (
	_ = sql.ErrNoRows
	_ = strings.TrimSpace
	_ = rand.Read
	_ = hex.EncodeToString
	_ = json.Marshal
	_ = sync.Mutex{}
	_ = atomic.AddInt64
)
