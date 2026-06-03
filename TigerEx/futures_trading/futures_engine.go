// =============================================================================
// TIGEREX v3.0 - FUTURES TRADING ENGINE
// USDT-M and COIN-M perpetual futures with funding
// =============================================================================

package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
)

// =============================================================================
// FUTURES TYPES
// =============================================================================

type FuturesContract struct {
	Symbol          string        `json:"symbol"`
	BaseAsset       string        `json:"baseAsset"`
	QuoteAsset      string        `json:"quoteAsset"`
	Type            ContractType  `json:"type"`
	ContractType    string        `json:"contractType"`
	Status          string        `json:"status"`
	TickSize        float64       `json:"tickSize"`
	LotSize         float64       `json:"lotSize"`
	MinQty          float64       `json:"minQty"`
	MaxQty          float64       `json:"maxQty"`
	MarginPrecision int           `json:"marginPrecision"`
	LeverageRange   []int         `json:"leverageRange"`
	MakerFee        float64       `json:"makerFee"`
	TakerFee        float64       `json:"takerFee"`
	FundingRate     float64       `json:"fundingRate"`
	NextFundingTime int64         `json:"nextFundingTime"`
	DeliveryTime    int64         `json:"deliveryTime,omitempty"`
	DeliveryPrice   float64       `json:"deliveryPrice,omitempty"`
}

type ContractType string

const (
	ContractTypePerpetual ContractType = "perpetual"
	ContractTypeDelivery   ContractType = "delivery"
	ContractTypeUSDTM      = "usdt_m"
	ContractTypeCOINM      = "coin_m"
)

type FuturesPosition struct {
	PositionID      string    `json:"positionId"`
	UserID          string    `json:"userId"`
	ContractSymbol  string    `json:"contractSymbol"`
	Side            OrderSide `json:"side"`
	Size            float64   `json:"size"`
	EntryPrice      float64   `json:"entryPrice"`
	Margin          float64   `json:"margin"`
	Leverage        float64   `json:"leverage"`
	LiquidationPrice float64  `json:"liquidationPrice"`
	MarkPrice       float64   `json:"markPrice"`
	IndexPrice      float64   `json:"indexPrice"`
	FairPrice       float64   `json:"fairPrice"`
	UnrealizedPNL   float64   `json:"unrealizedPnl"`
	RealizedPNL     float64   `json:"realizedPnl"`
	FundingFee      float64   `json:"fundingFee"`
	PositionMode    string    `json:"positionMode"`
	IsolatedMargin  float64    `json:"isolatedMargin,omitempty"`
	AutoTopUp       bool      `json:"autoTopUp"`
	StopLossPrice   float64   `json:"stopLossPrice,omitempty"`
	TakeProfitPrice float64   `json:"takeProfitPrice,omitempty"`
	OpenedAt        int64     `json:"openedAt"`
	UpdatedAt       int64     `json:"updatedAt"`
}

type FuturesOrder struct {
	OrderID        string     `json:"orderId"`
	UserID         string     `json:"userId"`
	ContractSymbol string     `json:"contractSymbol"`
	Side           OrderSide  `json:"side"`
	Type           OrderType  `json:"type"`
	Price          float64    `json:"price"`
	StopPrice      float64    `json:"stopPrice,omitempty"`
	Quantity       float64    `json:"quantity"`
	FilledQty      float64    `json:"filledQty"`
	AvgFillPrice   float64    `json:"avgFillPrice"`
	Leverage       float64    `json:"leverage"`
	PositionMode   string     `json:"positionMode"`
	MarginMode     string     `json:"marginMode"`
	ReduceOnly     bool       `json:"reduceOnly"`
	TimeInForce    TimeInForce `json:"timeInForce"`
	Status         OrderStatus `json:"status"`
	CreatedAt      int64      `json:"createdAt"`
	UpdatedAt      int64      `json:"updatedAt"`
}

type FundingHistory struct {
	Timestamp    int64   `json:"timestamp"`
	Contract     string  `json:"contract"`
	FundingRate  float64 `json:"fundingRate"`
	MarkPrice    float64 `json:"markPrice"`
	IndexPrice   float64 `json:"indexPrice"`
	FairPrice    float64 `json:"fairPrice"`
}

// =============================================================================
// FUTURES ENGINE
// =============================================================================

type FuturesEngine struct {
	mu sync.RWMutex

	contracts     map[string]*FuturesContract
	orderBooks    map[string]*FuturesOrderBook
	positions     map[string]*FuturesPosition
	userPositions map[string][]*FuturesPosition
	orders        map[string]*FuturesOrder
	fundingHistory map[string][]*FundingHistory
	insuranceFund float64
	config        FuturesConfig
	stats         FuturesStats

	onLiquidation   func(*FuturesPosition, string)
	onFunding       func(string, float64)
	onPositionUpdate func(*FuturesPosition)

	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

type FuturesConfig struct {
	MaxLeverage        float64
	MakerFee           float64
	TakerFee           float64
	FundingInterval    int64
	LiquidationPercent float64
	InsuranceFundRate  float64
	AutoDeleverageEnabled bool
	PartialLiquidationEnabled bool
	PartialLiquidationPercent float64
}

type FuturesStats struct {
	mu               sync.Mutex
	TotalLiquidations int64
	TotalVolume       float64
	TotalFees         float64
	InsuranceFundBalance float64
}

type FuturesOrderBook struct {
	Symbol      string
	Bids        []*FuturesPriceLevel
	Asks        []*FuturesPriceLevel
	MarkPrice   float64
	IndexPrice  float64
	FairPrice   float64
	LastUpdateID int64
}

type FuturesPriceLevel struct {
	Price    float64
	Quantity  float64
	Orders    int
}

// =============================================================================
// FUTURES ENGINE METHODS
// =============================================================================

func NewFuturesEngineV2() *FuturesEngine {
	ctx, cancel := context.WithCancel(context.Background())

	engine := &FuturesEngine{
		contracts:     make(map[string]*FuturesContract),
		orderBooks:    make(map[string]*FuturesOrderBook),
		positions:     make(map[string]*FuturesPosition),
		userPositions: make(map[string][]*FuturesPosition),
		orders:        make(map[string]*FuturesOrder),
		fundingHistory: make(map[string][]*FundingHistory),
		ctx:           ctx,
		cancel:        cancel,
		config: FuturesConfig{
			MaxLeverage: 125,
			MakerFee:    0.0002,
			TakerFee:    0.0004,
			FundingInterval: 28800,
			LiquidationPercent: 0.8,
			InsuranceFundRate: 0.0001,
			AutoDeleverageEnabled: true,
			PartialLiquidationEnabled: true,
			PartialLiquidationPercent: 0.25,
		},
	}

	engine.initializeDefaultContracts()
	engine.startWorkers()

	return engine
}

func (e *FuturesEngine) initializeDefaultContracts() {
	contracts := []*FuturesContract{
		{"BTCUSDT", "BTC", "USDT", ContractTypePerpetual, ContractTypeUSDTM, "trading", 0.01, 0.00001, 0.00001, math.MaxFloat64, 8, []int{1, 2, 3, 5, 10, 20, 50, 75, 100, 125}, 0.0002, 0.0004, 0.0001, time.Now().Add(8 * time.Hour).Unix(), 0, 0},
		{"ETHUSDT", "ETH", "USDT", ContractTypePerpetual, ContractTypeUSDTM, "trading", 0.01, 0.0001, 0.0001, math.MaxFloat64, 8, []int{1, 2, 3, 5, 10, 20, 50, 75, 100}, 0.0002, 0.0004, 0.0001, time.Now().Add(8 * time.Hour).Unix(), 0, 0},
		{"BNBUSDT", "BNB", "USDT", ContractTypePerpetual, ContractTypeUSDTM, "trading", 0.01, 0.001, 0.001, math.MaxFloat64, 8, []int{1, 2, 3, 5, 10, 20, 50, 75}, 0.0002, 0.0004, 0.0001, time.Now().Add(8 * time.Hour).Unix(), 0, 0},
		{"SOLUSDT", "SOL", "USDT", ContractTypePerpetual, ContractTypeUSDTM, "trading", 0.01, 0.01, 0.01, math.MaxFloat64, 8, []int{1, 2, 3, 5, 10, 20, 50, 75}, 0.0002, 0.0004, 0.0001, time.Now().Add(8 * time.Hour).Unix(), 0, 0},
		{"BTCUSD", "BTC", "USD", ContractTypePerpetual, ContractTypeCOINM, "trading", 0.1, 0.0001, 0.0001, math.MaxFloat64, 4, []int{1, 2, 3, 5, 10, 20, 50, 100}, 0.0002, 0.0004, 0.0001, time.Now().Add(8 * time.Hour).Unix(), 0, 0},
	}

	for _, contract := range contracts {
		e.contracts[contract.Symbol] = contract
		e.fundingHistory[contract.Symbol] = make([]*FundingHistory, 0)
	}

	log.Printf("[INFO] Initialized %d futures contracts", len(contracts))
}

func (e *FuturesEngine) startWorkers() {
	e.wg.Add(1)
	go func() {
		defer e.wg.Done()
		ticker := time.NewTicker(time.Duration(e.config.FundingInterval) * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-e.ctx.Done():
				return
			case <-ticker.C:
				e.processFunding()
			}
		}
	}()

	e.wg.Add(1)
	go func() {
		defer e.wg.Done()
		ticker := time.NewTicker(1 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-e.ctx.Done():
				return
			case <-ticker.C:
				e.monitorLiquidations()
			}
		}
	}()
}

func (e *FuturesEngine) Shutdown() {
	e.cancel()
	e.wg.Wait()
}

// =============================================================================
// ORDER MANAGEMENT
// =============================================================================

type FuturesOrderRequestV2 struct {
	UserID         string
	ContractSymbol string
	Side           OrderSide
	Type           OrderType
	Price          float64
	StopPrice      float64
	Quantity       float64
	Leverage       float64
	PositionMode   string
	MarginMode     string
	ReduceOnly     bool
	TimeInForce    TimeInForce
}

func (e *FuturesEngine) PlaceOrder(req *FuturesOrderRequestV2) (*FuturesOrder, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	if req.Quantity <= 0 {
		return nil, errors.New("quantity must be positive")
	}
	if req.Price <= 0 && req.Type != OrderTypeMarket {
		return nil, errors.New("price must be positive")
	}
	if req.Leverage < 1 || req.Leverage > e.config.MaxLeverage {
		return nil, fmt.Errorf("leverage must be between 1 and %.0f", e.config.MaxLeverage)
	}

	contract, ok := e.contracts[req.ContractSymbol]
	if !ok {
		return nil, errors.New("contract not found")
	}

	positionValue := req.Price * req.Quantity
	requiredMargin := positionValue / req.Leverage

	order := &FuturesOrder{
		OrderID:        e.generateOrderID(),
		UserID:         req.UserID,
		ContractSymbol: req.ContractSymbol,
		Side:          req.Side,
		Type:          req.Type,
		Price:         req.Price,
		StopPrice:     req.StopPrice,
		Quantity:      req.Quantity,
		FilledQty:     0,
		AvgFillPrice:  0,
		Leverage:      req.Leverage,
		PositionMode:  req.PositionMode,
		MarginMode:    req.MarginMode,
		ReduceOnly:    req.ReduceOnly,
		TimeInForce:   req.TimeInForce,
		Status:        OrderStatusNew,
		CreatedAt:     time.Now().UnixMilli(),
		UpdatedAt:     time.Now().UnixMilli(),
	}

	// Execute order
	var fills []*Fill
	var err error

	if req.Type == OrderTypeMarket {
		fills, err = e.executeMarketOrderV2(order, contract)
	}

	if err != nil {
		return nil, err
	}

	for _, fill := range fills {
		e.processFillV2(order, fill, contract)
	}

	e.orders[order.OrderID] = order

	log.Printf("[INFO] Futures order placed: %s %s %s %s %.4f @ %.8f x%.0f",
		order.OrderID, req.UserID, req.Side, req.ContractSymbol, req.Quantity, req.Price, req.Leverage)

	return order, nil
}

type Fill struct {
	Price    float64
	Quantity float64
	Role     string
}

func (e *FuturesEngine) executeMarketOrderV2(order *FuturesOrder, contract *FuturesContract) ([]*Fill, error) {
	markPrice := e.getMarkPrice(order.ContractSymbol)
	if markPrice == 0 {
		markPrice = order.Price
	}

	fill := &Fill{
		Price:    markPrice,
		Quantity: order.Quantity,
		Role:     "taker",
	}

	return []*Fill{fill}, nil
}

func (e *FuturesEngine) processFillV2(order *FuturesOrder, fill *Fill, contract *FuturesContract) {
	order.FilledQty += fill.Quantity
	if order.AvgFillPrice == 0 {
		order.AvgFillPrice = fill.Price
	} else {
		order.AvgFillPrice = (order.AvgFillPrice*(order.FilledQty-fill.Quantity) + fill.Price*fill.Quantity) / order.FilledQty
	}

	if order.FilledQty >= order.Quantity {
		order.Status = OrderStatusFilled
	} else {
		order.Status = OrderStatusPartiallyFilled
	}

	e.updatePositionV2(order, fill, contract)
}

func (e *FuturesEngine) updatePositionV2(order *FuturesOrder, fill *Fill, contract *FuturesContract) {
	posKey := fmt.Sprintf("%s:%s", order.UserID, order.ContractSymbol)

	if existing, ok := e.positions[posKey]; ok {
		if order.ReduceOnly && existing.Side == order.Side {
			newSize := existing.Size + fill.Quantity
			existing.EntryPrice = (existing.EntryPrice*existing.Size + fill.Price*fill.Quantity) / newSize
			existing.Size = newSize
		} else if existing.Side != order.Side {
			if fill.Quantity >= existing.Size {
				existing.Side = order.Side
				existing.Size = fill.Quantity - existing.Size
				existing.EntryPrice = fill.Price
			} else {
				existing.Size -= fill.Quantity
			}
		} else {
			newSize := existing.Size + fill.Quantity
			existing.EntryPrice = (existing.EntryPrice*existing.Size + fill.Price*fill.Quantity) / newSize
			existing.Size = newSize
		}

		marginDelta := (fill.Price * fill.Quantity) / order.Leverage
		if order.PositionMode == "isolated" {
			existing.IsolatedMargin += marginDelta
		}
		existing.Margin += marginDelta

		e.calculateLiquidationPriceV2(existing, contract)
		existing.UpdatedAt = time.Now().UnixMilli()

		if e.onPositionUpdate != nil {
			e.onPositionUpdate(existing)
		}
	} else {
		liquidationPrice := e.calculateLiquidationPriceValue(order.Side, fill.Price, order.Leverage, contract)

		position := &FuturesPosition{
			PositionID:      e.generatePositionID(),
			UserID:         order.UserID,
			ContractSymbol: order.ContractSymbol,
			Side:           order.Side,
			Size:           fill.Quantity,
			EntryPrice:     fill.Price,
			Margin:         (fill.Price * fill.Quantity) / order.Leverage,
			Leverage:       order.Leverage,
			LiquidationPrice: liquidationPrice,
			MarkPrice:      fill.Price,
			IndexPrice:     fill.Price,
			FairPrice:      fill.Price,
			PositionMode:   order.PositionMode,
			IsolatedMargin: (fill.Price * fill.Quantity) / order.Leverage,
			OpenedAt:       time.Now().UnixMilli(),
			UpdatedAt:      time.Now().UnixMilli(),
		}

		e.positions[posKey] = position
		e.userPositions[order.UserID] = append(e.userPositions[order.UserID], position)

		if e.onPositionUpdate != nil {
			e.onPositionUpdate(position)
		}
	}
}

func (e *FuturesEngine) calculateLiquidationPriceV2(position *FuturesPosition, contract *FuturesContract) {
	position.LiquidationPrice = e.calculateLiquidationPriceValue(position.Side, position.EntryPrice, position.Leverage, contract)
}

func (e *FuturesEngine) calculateLiquidationPriceValue(side OrderSide, entryPrice, leverage float64, contract *FuturesContract) float64 {
	liquidationPercent := 1 / leverage * e.config.LiquidationPercent
	
	if side == OrderSideBuy {
		return entryPrice * (1 - liquidationPercent)
	}
	return entryPrice * (1 + liquidationPercent)
}

// =============================================================================
// LIQUIDATION
// =============================================================================

func (e *FuturesEngine) monitorLiquidations() {
	e.mu.Lock()
	defer e.mu.Unlock()

	for _, position := range e.positions {
		if position.Size == 0 {
			continue
		}

		positionValue := position.Size * position.MarkPrice
		marginRatio := position.Margin / positionValue

		if marginRatio < e.config.LiquidationPercent {
			e.liquidatePositionV2(position)
		}
	}
}

func (e *FuturesEngine) liquidatePositionV2(position *FuturesPosition) {
	log.Printf("[WARN] Futures liquidation: %s %s %s size=%.4f",
		position.PositionID, position.UserID, position.ContractSymbol, position.Size)

	var pnl float64
	if position.Side == OrderSideBuy {
		pnl = (position.MarkPrice - position.EntryPrice) * position.Size
	} else {
		pnl = (position.EntryPrice - position.MarkPrice) * position.Size
	}

	liquidationPrice := position.MarkPrice
	if position.Side == OrderSideBuy {
		liquidationPrice *= 0.995
	} else {
		liquidationPrice *= 1.005
	}

	if pnl < 0 {
		deficit := -pnl
		if e.insuranceFund >= deficit {
			e.insuranceFund -= deficit
		} else {
			e.insuranceFund = 0
		}
	} else {
		e.insuranceFund += pnl * e.config.InsuranceFundRate
	}

	posKey := fmt.Sprintf("%s:%s", position.UserID, position.ContractSymbol)
	delete(e.positions, posKey)

	atomic.AddInt64(&e.stats.TotalLiquidations, 1)
	e.stats.LiquidatedVolume += position.Size * position.MarkPrice

	if e.onLiquidation != nil {
		e.onLiquidation(position, "margin_ratio")
	}

	log.Printf("[INFO] Position liquidated: %s PnL=%.8f", position.PositionID, pnl)
}

// =============================================================================
// FUNDING
// =============================================================================

func (e *FuturesEngine) processFunding() {
	e.mu.Lock()
	defer e.mu.Unlock()

	now := time.Now().Unix()

	for symbol, contract := range e.contracts {
		if contract.Type != ContractTypePerpetual {
			continue
		}

		if now < contract.NextFundingTime {
			continue
		}

		fundingRate := e.calculateFundingRate(symbol)

		for _, position := range e.positions {
			if position.ContractSymbol != symbol {
				continue
			}

			positionValue := position.Size * position.MarkPrice
			fundingPayment := positionValue * fundingRate

			if position.Side == OrderSideBuy {
				position.FundingFee += fundingPayment
				position.Margin -= fundingPayment
			} else {
				position.FundingFee -= fundingPayment
				position.Margin += fundingPayment
			}
		}

		funding := &FundingHistory{
			Timestamp:   now,
			Contract:    symbol,
			FundingRate: fundingRate,
			MarkPrice:   e.getMarkPrice(symbol),
		}
		e.fundingHistory[symbol] = append(e.fundingHistory[symbol], funding)

		if len(e.fundingHistory[symbol]) > 1000 {
			e.fundingHistory[symbol] = e.fundingHistory[symbol][1:]
		}

		contract.NextFundingTime += e.config.FundingInterval
		contract.FundingRate = fundingRate

		if e.onFunding != nil {
			e.onFunding(symbol, fundingRate)
		}

		log.Printf("[INFO] Funding processed: %s rate=%.6f", symbol, fundingRate)
	}
}

func (e *FuturesEngine) calculateFundingRate(symbol string) float64 {
	ob, ok := e.orderBooks[symbol]
	if !ok {
		return 0.0001
	}

	if ob.FairPrice > 0 && ob.IndexPrice > 0 {
		premium := (ob.FairPrice - ob.IndexPrice) / ob.IndexPrice
		if premium > 0.0005 {
			premium = 0.0005
		} else if premium < -0.0005 {
			premium = -0.0005
		}
		return premium
	}

	return 0.0001
}

// =============================================================================
// MARK PRICE
// =============================================================================

func (e *FuturesEngine) UpdateMarkPrice(symbol string, markPrice, indexPrice, fairPrice float64) {
	e.mu.Lock()
	defer e.mu.Unlock()

	ob, ok := e.orderBooks[symbol]
	if !ok {
		ob = &FuturesOrderBook{
			Symbol: symbol,
			Bids:   make([]*FuturesPriceLevel, 0),
			Asks:   make([]*FuturesPriceLevel, 0),
		}
		e.orderBooks[symbol] = ob
	}

	ob.MarkPrice = markPrice
	ob.IndexPrice = indexPrice
	ob.FairPrice = fairPrice
	ob.LastUpdateID++

	for _, position := range e.positions {
		if position.ContractSymbol != symbol {
			continue
		}

		position.MarkPrice = markPrice
		position.IndexPrice = indexPrice
		position.FairPrice = fairPrice

		if position.Side == OrderSideBuy {
			position.UnrealizedPNL = (markPrice - position.EntryPrice) * position.Size
		} else {
			position.UnrealizedPNL = (position.EntryPrice - markPrice) * position.Size
		}
	}
}

func (e *FuturesEngine) getMarkPrice(symbol string) float64 {
	if ob, ok := e.orderBooks[symbol]; ok {
		return ob.MarkPrice
	}
	return 0
}

// =============================================================================
// UTILITIES
// =============================================================================

func (e *FuturesEngine) generateOrderID() string {
	return fmt.Sprintf("FUT-ORD-%s", uuid.New().String()[:12])
}

func (e *FuturesEngine) generatePositionID() string {
	return fmt.Sprintf("FUT-POS-%s", uuid.New().String()[:12])
}

func (e *FuturesEngine) GetStats() FuturesStats {
	e.stats.mu.Lock()
	defer e.stats.mu.Unlock()
	e.stats.InsuranceFundBalance = e.insuranceFund
	return e.stats
}

// Placeholder
var _ = fmt.Sprintf
var _ = log.Printf