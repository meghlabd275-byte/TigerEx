package futures_trading

import (
	"errors"
	"fmt"
	"math"
	"math/rand"
	"sync"
	"time"
)

// ContractType represents the type of futures contract
type ContractType string

const (
	ContractTypePerpetual ContractType = "PERPETUAL"
	ContractTypeDelivery   ContractType = "DELIVERY"
	ContractTypeQuarterly  ContractType = "QUARTERLY"
)

// MarginMode represents the margin mode
type MarginMode string

const (
	MarginModeCross     MarginMode = "CROSS"
	MarginModeIsolated  MarginMode = "ISOLATED"
)

// PositionSide represents long or short
type PositionSide string

const (
	PositionSideLong  PositionSide = "LONG"
	PositionSideShort PositionSide = "SHORT"
)

// FuturesContract represents a futures contract configuration
type FuturesContract struct {
	Symbol         string        `json:"symbol"`
	Type           ContractType  `json:"type"`
	BaseAsset      string        `json:"base_asset"`
	QuoteAsset     string        `json:"quote_asset"`
	ContractSize   float64       `json:"contract_size"`
	LotSize        float64       `json:"lot_size"`
	MaxLeverage    int           `json:"max_leverage"`
	MinLeverage    int           `json:"min_leverage"`
	FundingRate    float64       `json:"funding_rate"`
	NextFundingTime time.Time    `json:"next_funding_time"`
	MakerFee       float64       `json:"maker_fee"`
	TakerFee       float64       `json:"taker_fee"`
	settlementTime *time.Time    `json:"settlement_time,omitempty"`
	IsTrading      bool          `json:"is_trading"`
}

// Position represents a user's futures position
type Position struct {
	Symbol         string        `json:"symbol"`
	UserID         string        `json:"user_id"`
	Side           PositionSide  `json:"side"`
	Quantity       float64       `json:"quantity"` // in contracts
	EntryPrice     float64       `json:"entry_price"`
	MarkPrice      float64       `json:"mark_price"`
	LiquidationPrice float64     `json:"liquidation_price"`
	Leverage       int           `json:"leverage"`
	MarginMode     MarginMode    `json:"margin_mode"`
	IsolatedMargin float64       `json:"isolated_margin"`
	UnrealizedPnL  float64       `json:"unrealized_pnl"`
	RealizedPnL    float64       `json:"realized_pnl"`
	FundingFee     float64       `json:"funding_fee"`
	CreatedAt      time.Time     `json:"created_at"`
	UpdatedAt      time.Time     `json:"updated_at"`
}

// FuturesOrder represents a futures order
type FuturesOrder struct {
	ID            string         `json:"id"`
	Symbol        string         `json:"symbol"`
	Side          PositionSide   `json:"side"`
	PositionSide  PositionSide   `json:"position_side"`
	Type          string         `json:"type"` // MARKET, LIMIT, STOP
	Price         float64        `json:"price"`
	StopPrice     float64        `json:"stop_price"`
	Quantity      float64        `json:"quantity"`
	FilledQty     float64        `json:"filled_quantity"`
	AvgFillPrice  float64        `json:"avg_fill_price"`
	Leverage      int            `json:"leverage"`
	MarginMode    MarginMode     `json:"margin_mode"`
	Status        string         `json:"status"`
	UserID        string         `json:"user_id"`
	ReduceOnly    bool           `json:"reduce_only"`
	ClosePosition bool           `json:"close_position"`
	CreatedAt     time.Time      `json:"created_at"`
}

// FuturesTrade represents an executed futures trade
type FuturesTrade struct {
	ID             string    `json:"id"`
	OrderID        string    `json:"order_id"`
	Symbol         string    `json:"symbol"`
	Side           string    `json:"side"`
	PositionSide   string    `json:"position_side"`
	Price          float64   `json:"price"`
	Quantity       float64   `json:"quantity"`
	QuoteQty       float64   `json:"quote_quantity"`
	Fee            float64   `json:"fee"`
	FeeAsset       string    `json:"fee_asset"`
	RealizedPnL    float64   `json:"realized_pnl"`
	TradeTime      time.Time `json:"trade_time"`
}

// FundingPayment represents funding rate payment
type FundingPayment struct {
	UserID     string    `json:"user_id"`
	Symbol     string    `json:"symbol"`
	Rate       float64   `json:"rate"`
	Payment    float64   `json:"payment"` // positive = pay, negative = receive
	Timestamp  time.Time `json:"timestamp"`
}

// FuturesService handles futures trading operations
type FuturesService struct {
	mu           sync.RWMutex
	contracts    map[string]*FuturesContract
	positions   map[string]*Position // key: userID_symbol
	orders       map[string]*FuturesOrder
	userOrders   map[string][]string
	tradeChan    chan *FuturesTrade
	fundingChan  chan *FundingPayment

	// Insurance fund
	insuranceFund float64

	// Index prices
	indexPrices map[string]float64

	// Mark prices
	markPrices map[string]float64
}

// NewFuturesService creates a new futures service
func NewFuturesService() *FuturesService {
	return &FuturesService{
		contracts:   make(map[string]*FuturesContract),
		positions:   make(map[string]*Position),
		orders:      make(map[string]*FuturesOrder),
		userOrders:  make(map[string][]string),
		tradeChan:   make(chan *FuturesTrade, 10000),
		fundingChan: make(chan *FundingPayment, 10000),
		insuranceFund: 0,
		indexPrices: make(map[string]float64),
		markPrices:  make(map[string]float64),
	}
}

// RegisterContract registers a new futures contract
func (s *FuturesService) RegisterContract(contract *FuturesContract) error {
	if contract.Symbol == "" {
		return errors.New("contract symbol required")
	}
	if contract.MaxLeverage < contract.MinLeverage {
		return errors.New("invalid leverage range")
	}
	
	s.mu.Lock()
	defer s.mu.Unlock()
	s.contracts[contract.Symbol] = contract
	s.markPrices[contract.Symbol] = 0
	s.indexPrices[contract.Symbol] = 0
	
	return nil
}

// OpenPosition opens a new futures position
func (s *FuturesService) OpenPosition(order *FuturesOrder) (*Position, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	contract, exists := s.contracts[order.Symbol]
	if !exists {
		return nil, errors.New("contract not found")
	}

	if !contract.IsTrading {
		return nil, errors.New("contract not trading")
	}

	if order.Leverage < contract.MinLeverage || order.Leverage > contract.MaxLeverage {
		return nil, fmt.Errorf("invalid leverage: %d (min: %d, max: %d)", 
			order.Leverage, contract.MinLeverage, contract.MaxLeverage)
	}

	positionKey := fmt.Sprintf("%s_%s", order.UserID, order.Symbol)
	existingPosition, hasPosition := s.positions[positionKey]

	// Calculate position value
	positionValue := order.Price * order.Quantity * contract.ContractSize
	requiredMargin := positionValue / float64(order.Leverage)

	if hasPosition {
		// Check if adding to position or reducing
		if existingPosition.Side == order.PositionSide {
			// Add to position - weighted average entry price
			totalQty := existingPosition.Quantity + order.Quantity
			existingPosition.EntryPrice = (existingPosition.EntryPrice*existingPosition.Quantity + order.Price*order.Quantity) / totalQty
			existingPosition.Quantity = totalQty
			existingPosition.Leverage = order.Leverage
			existingPosition.UpdatedAt = time.Now()
			
			if order.MarginMode == MarginModeIsolated {
				existingPosition.IsolatedMargin = requiredMargin
			}
			
			return existingPosition, nil
		} else {
			// Closing or reducing position
			if order.Quantity >= existingPosition.Quantity {
				// Full or over-close
				closeQty := existingPosition.Quantity
				
				// Calculate realized PnL
				var pnl float64
				if existingPosition.Side == PositionSideLong {
					pnl = (order.Price - existingPosition.EntryPrice) * closeQty * contract.ContractSize
				} else {
					pnl = (existingPosition.EntryPrice - order.Price) * closeQty * contract.ContractSize
				}
				
				existingPosition.RealizedPnL += pnl
				
				if order.Quantity > closeQty {
					// Open opposite position with remaining
					order.Quantity = order.Quantity - closeQty
					existingPosition.Side = order.PositionSide
					existingPosition.Quantity = order.Quantity
					existingPosition.EntryPrice = order.Price
					existingPosition.Leverage = order.Leverage
					existingPosition.MarkPrice = order.Price
				} else {
					// Fully closed
					delete(s.positions, positionKey)
					return existingPosition, nil
				}
			} else {
				// Partial close
				var pnl float64
				if existingPosition.Side == PositionSideLong {
					pnl = (order.Price - existingPosition.EntryPrice) * order.Quantity * contract.ContractSize
				} else {
					pnl = (existingPosition.EntryPrice - order.Price) * order.Quantity * contract.ContractSize
				}
				
				existingPosition.Quantity -= order.Quantity
				existingPosition.RealizedPnL += pnl
				existingPosition.UpdatedAt = time.Now()
				
				return existingPosition, nil
			}
		}
	}

	// Create new position
	position := &Position{
		Symbol:          order.Symbol,
		UserID:          order.UserID,
		Side:            order.PositionSide,
		Quantity:        order.Quantity,
		EntryPrice:      order.Price,
		MarkPrice:       order.Price,
		Leverage:        order.Leverage,
		MarginMode:      order.MarginMode,
		IsolatedMargin:  requiredMargin,
		CreatedAt:       time.Now(),
		UpdatedAt:       time.Now(),
	}

	// Calculate liquidation price
	position.LiquidationPrice = s.calculateLiquidationPrice(position, contract)

	s.positions[positionKey] = position

	// Create trade
	trade := s.createTrade(order, contract, 0)
	select {
	case s.tradeChan <- trade:
	default:
	}

	return position, nil
}

// CalculateLiquidationPrice calculates the liquidation price for a position
func (s *FuturesService) calculateLiquidationPrice(position *Position, contract *FuturesContract) float64 {
	var bankruptcyPrice float64

	if position.Side == PositionSideLong {
		// Long liquidation: entry * (1 - 1/leverage)
		bankruptcyPrice = position.EntryPrice * (1 - 1/float64(position.Leverage))
	} else {
		// Short liquidation: entry * (1 + 1/leverage)
		bankruptcyPrice = position.EntryPrice * (1 + 1/float64(position.Leverage))
	}

	// Add buffer
	buffer := 0.01 // 1% buffer
	if position.Side == PositionSideLong {
		return bankruptcyPrice * (1 - buffer)
	}
	return bankruptcyPrice * (1 + buffer)
}

// UpdateMarkPrice updates the mark price and checks for liquidations
func (s *FuturesService) UpdateMarkPrice(symbol string, markPrice float64) ([]*Position, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	contract, exists := s.contracts[symbol]
	if !exists {
		return nil, errors.New("contract not found")
	}

	s.markPrices[symbol] = markPrice

	// Update all positions with this symbol
	var liquidations []*Position

	for key, position := range s.positions {
		if position.Symbol != symbol {
			continue
		}

		// Update mark price
		position.MarkPrice = markPrice

		// Calculate unrealized PnL
		if position.Side == PositionSideLong {
			position.UnrealizedPnL = (markPrice - position.EntryPrice) * position.Quantity * contract.ContractSize
		} else {
			position.UnrealizedPnL = (position.EntryPrice - markPrice) * position.Quantity * contract.ContractSize
		}

		// Check liquidation
		if s.shouldLiquidate(position) {
			liquidations = append(liquidations, position)
		}
	}

	return liquidations, nil
}

// ShouldLiquidate checks if a position should be liquidated
func (s *FuturesService) shouldLiquidate(position *Position) bool {
	if position.MarginMode == MarginModeIsolated {
		// Isolated margin: check if unrealized PnL > isolated margin
		return position.UnrealizedPnL < -position.IsolatedMargin
	}

	// Cross margin: check maintenance margin
	maintenanceMarginRate := 0.005 // 0.5%
	positionValue := position.MarkPrice * position.Quantity * 1 // contract size assumed 1
	
	if position.Side == PositionSideLong {
		positionValue = positionValue // already calculated
	}
	
	maintenanceMargin := positionValue * maintenanceMarginRate
	marginBalance := position.IsolatedMargin + position.UnrealizedPnL

	return marginBalance < maintenanceMargin
}

// LiquidatePosition liquidates a position
func (s *FuturesService) LiquidatePosition(position *Position) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	contract, exists := s.contracts[position.Symbol]
	if !exists {
		return errors.New("contract not found")
	}

	positionKey := fmt.Sprintf("%s_%s", position.UserID, position.Symbol)

	// Get current market price for liquidation
	liquidationPrice := s.markPrices[position.Symbol]
	if liquidationPrice == 0 {
		liquidationPrice = position.MarkPrice
	}

	// Calculate loss
	var loss float64
	if position.Side == PositionSideLong {
		loss = (position.LiquidationPrice - position.EntryPrice) * position.Quantity * contract.ContractSize
	} else {
		loss = (position.EntryPrice - position.LiquidationPrice) * position.Quantity * contract.ContractSize
	}

	// Add to insurance fund
	s.insuranceFund += math.Abs(loss) * 0.25 // 25% of loss goes to insurance

	// Remove position
	delete(s.positions, positionKey)

	return nil
}

// GetPosition retrieves a user's position for a symbol
func (s *FuturesService) GetPosition(userID, symbol string) (*Position, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	positionKey := fmt.Sprintf("%s_%s", userID, symbol)
	position, exists := s.positions[positionKey]
	if !exists {
		return nil, errors.New("position not found")
	}

	return position, nil
}

// GetAllPositions retrieves all positions for a user
func (s *FuturesService) GetAllPositions(userID string) []*Position {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var positions []*Position
	for key, position := range s.positions {
		if position.UserID == userID {
			positions = append(positions, position)
		}
	}

	return positions
}

// ProcessFundingPayments processes funding rate payments
func (s *FuturesService) ProcessFundingPayments(symbol string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	contract, exists := s.contracts[symbol]
	if !exists {
		return errors.New("contract not found")
	}

	if time.Now().Before(contract.NextFundingTime) {
		return nil
	}

	fundingRate := contract.FundingRate

	// Calculate and distribute funding payments
	for key, position := range s.positions {
		if position.Symbol != symbol {
			continue
		}

		positionValue := position.MarkPrice * position.Quantity * contract.ContractSize
		fundingPayment := positionValue * fundingRate

		// Longs pay shorts (or vice versa based on funding rate)
		if fundingRate > 0 {
			// Longs pay shorts
			if position.Side == PositionSideLong {
				position.FundingFee = -fundingPayment
			} else {
				position.FundingFee = fundingPayment
			}
		} else {
			// Shorts pay longs
			if position.Side == PositionSideShort {
				position.FundingFee = -fundingPayment
			} else {
				position.FundingFee = fundingPayment
			}
		}

		// Send funding payment to channel
		payment := &FundingPayment{
			UserID:    position.UserID,
			Symbol:    symbol,
			Rate:      fundingRate,
			Payment:   position.FundingFee,
			Timestamp: time.Now(),
		}

		select {
		case s.fundingChan <- payment:
		default:
		}

		_ = key // suppress unused warning
	}

	// Update next funding time (typically every 8 hours)
	contract.NextFundingTime = contract.NextFundingTime.Add(8 * time.Hour)

	return nil
}

// PlaceOrder places a new futures order
func (s *FuturesService) PlaceOrder(order *FuturesOrder) (*FuturesOrder, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	contract, exists := s.contracts[order.Symbol]
	if !exists {
		return nil, errors.New("contract not found")
	}

	if !contract.IsTrading {
		return nil, errors.New("contract not trading")
	}

	order.ID = generateID()
	order.CreatedAt = time.Now()
	order.Status = "NEW"

	s.orders[order.ID] = order
	s.userOrders[order.UserID] = append(s.userOrders[order.UserID], order.ID)

	// Execute market orders immediately
	if order.Type == "MARKET" {
		order.FilledQty = order.Quantity
		order.AvgFillPrice = order.Price
		order.Status = "FILLED"

		// Open position
		futuresOrder := &FuturesOrder{
			ID:           order.ID,
			Symbol:       order.Symbol,
			Side:         order.Side,
			PositionSide: order.PositionSide,
			Price:        order.Price,
			Quantity:     order.Quantity,
			Leverage:     order.Leverage,
			MarginMode:   order.MarginMode,
			UserID:       order.UserID,
		}

		_, err := s.executeOrder(futuresOrder, contract)
		if err != nil {
			return nil, err
		}
	}

	return order, nil
}

func (s *FuturesService) executeOrder(order *FuturesOrder, contract *FuturesContract) (*FuturesOrder, error) {
	position, err := s.OpenPosition(order)
	if err != nil {
		return nil, err
	}

	// Update order with execution details
	order.FilledQty = order.Quantity
	order.AvgFillPrice = order.Price
	order.Status = "FILLED"

	// Create trade
	trade := s.createTrade(order, contract, position.RealizedPnL)
	select {
	case s.tradeChan <- trade:
	default:
	}

	return order, nil
}

func (s *FuturesService) createTrade(order *FuturesOrder, contract *FuturesContract, realizedPnL float64) *FuturesTrade {
	fee := order.Price * order.Quantity * contract.ContractSize * contract.TakerFee

	return &FuturesTrade{
		ID:           generateID(),
		OrderID:      order.ID,
		Symbol:       order.Symbol,
		Side:         string(order.Side),
		PositionSide: string(order.PositionSide),
		Price:        order.Price,
		Quantity:     order.Quantity,
		QuoteQty:     order.Price * order.Quantity * contract.ContractSize,
		Fee:          fee,
		FeeAsset:     contract.QuoteAsset,
		RealizedPnL:  realizedPnL,
		TradeTime:   time.Now(),
	}
}

// GetFundingRate returns the current funding rate for a symbol
func (s *FuturesService) GetFundingRate(symbol string) (float64, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	contract, exists := s.contracts[symbol]
	if !exists {
		return 0, errors.New("contract not found")
	}

	return contract.FundingRate, nil
}

// GetInsuranceFundBalance returns the insurance fund balance
func (s *FuturesService) GetInsuranceFundBalance() float64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.insuranceFund
}

func generateID() string {
	return fmt.Sprintf("F%d_%d", time.Now().UnixNano(), rand.Int63())
}