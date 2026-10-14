// TigerEx Futures Trading Service
// Perpetual and delivery futures contracts

package futures

import (
	"errors"
	"fmt"
	"sync"
	"time"
)

const (
	ContractTypePerpetual = "perpetual"
	ContractTypeDelivery  = "delivery"

	PositionTypeLong   = "long"
	PositionTypeShort  = "short"

	OrderTypeLimit   = "limit"
	OrderTypeMarket  = "market"
	OrderTypeStopMarket = "stop_market"
	OrderTypeStopLimit = "stop_limit"

	StatusOpen     = "open"
	StatusClosed  = "closed"
	StatusLiquidated = "liquidated"
	StatusPending = "pending"

	SettlementFrequencyHourly = "hourly"
	SettlementFrequencyDaily  = "daily"
)

type FuturesContract struct {
	ID              string    `json:"id"`
	Symbol          string    `json:"symbol"`
	Name            string    `json:"name"`
	Underlying     string    `json:"underlying"`
	ContractType   string    `json:"contract_type"`
	Pair           string    `json:"pair"`
	PricePrecision int       `json:"price_precision"`
	QuantityPrecision int   `json:"quantity_precision"`
	MinQuantity    float64   `json:"min_quantity"`
	MaxQuantity    float64   `json:"max_quantity"`
	ContractSize  float64   `json:"contract_size"`
	MaxLeverage   int       `json:"max_leverage"`
	InitialMargin float64   `json:"initial_margin"`
	MaintenanceMargin float64 `json:"maintenance_margin"`
	SettlementFrequency string `json:"settlement_frequency"`
	FundingRate   float64   `json:"funding_rate"`
	MarkPrice     float64   `json:"mark_price"`
	IndexPrice    float64   `json:"index_price"`
	Status        string    `json:"status"`
}

type FuturesPosition struct {
	ID              string    `json:"id"`
	UserID          string    `json:"user_id"`
	ContractID     string    `json:"contract_id"`
	ContractSymbol string    `json:"contract_symbol"`
	Side           string    `json:"side"`
	Leverage       int       `json:"leverage"`
	EntryPrice     float64   `json:"entry_price"`
	MarkPrice      float64   `json:"mark_price"`
	Quantity       float64   `json:"quantity"`
	Margin         float64   `json:"margin"`
	UnrealizedPNL float64   `json:"unrealized_pnl"`
	RealizedPNL    float64   `json:"realized_pnl"`
	LiquidationPrice float64 `json:"liquidation_price"`
	StopLossPrice float64   `json:"stop_loss_price"`
	TakeProfitPrice float64 `json:"take_profit_price"`
	Status         string    `json:"status"`
	OpenedAt       time.Time `json:"opened_at"`
	UpdatedAt       time.Time `json:"updated_at"`
	ClosedAt        time.Time `json:"closed_at"`
}

type FuturesOrder struct {
	ID            string    `json:"id"`
	UserID        string    `json:"user_id"`
	ContractID   string    `json:"contract_id"`
	Side         string    `json:"side"`
	Type         string    `json:"type"`
	Price        float64   `json:"price"`
	StopPrice    float64   `json:"stop_price"`
	Quantity     float64   `json:"quantity"`
	FilledQty    float64   `json:"filled_qty"`
	AvgFillPrice float64   `json:"avg_fill_price"`
	Leverage     int       `json:"leverage"`
	Status       string    `json:"status"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
	ExpiredAt    time.Time `json:"expired_at"`
}

type FundingPayment struct {
	ID            string    `json:"id"`
	UserID        string    `json:"user_id"`
	ContractID   string    `json:"contract_id"`
	PositionSide string    `json:"position_side"`
	Payment      float64   `json:"payment"`
	FundingRate  float64   `json:"funding_rate"`
	MarkPrice    float64   `json:"mark_price"`
	PaidAt       time.Time `json:"paid_at"`
}

type FuturesManager struct {
	mu           sync.RWMutex
	contracts    map[string]*FuturesContract
	positions    map[string]*FuturesPosition
	orders       map[string]*FuturesOrder
	userPositions map[string]map[string]*FuturesPosition
	fundingHistory map[string][]FundingPayment
}

func NewFuturesManager() *FuturesManager {
	fm := &FuturesManager{
		contracts:     make(map[string]*FuturesContract),
		positions:    make(map[string]*FuturesPosition),
		orders:       make(map[string]*FuturesOrder),
		userPositions: make(map[string]map[string]*FuturesPosition),
		fundingHistory: make(map[string][]FundingPayment),
	}
	fm.initializeContracts()
	return fm
}

func (fm *FuturesManager) initializeContracts() {
	// Contracts must come from the canonical persistent instrument registry.
	return
}

func (fm *FuturesManager) GetContracts() []*FuturesContract {
	fm.mu.RLock()
	defer fm.mu.RUnlock()

	contracts := make([]*FuturesContract, 0, len(fm.contracts))
	for _, c := range fm.contracts {
		contracts = append(contracts, c)
	}
	return contracts
}

func (fm *FuturesManager) GetContract(contractID string) (*FuturesContract, error) {
	fm.mu.RLock()
	defer fm.mu.RUnlock()

	contract, exists := fm.contracts[contractID]
	if !exists {
		return nil, errors.New("contract not found")
	}
	return contract, nil
}

func (fm *FuturesManager) PlaceOrder(userID, contractID, side, orderType string, price, stopPrice, quantity float64, leverage int) (*FuturesOrder, error) {
	return nil, errors.New("futures order placement unavailable: canonical risk, ledger and matching services are not configured")
}

func (fm *FuturesManager) OpenPosition(userID, contractID, side string, quantity, entryPrice float64, leverage int) (*FuturesPosition, error) {
	return nil, errors.New("futures position opening unavailable: canonical margin ledger and risk service are not configured")
}

func (fm *FuturesManager) calculateLiquidationPrice(entryPrice float64, leverage int, side string) float64 {
	liqPercent := 1.0 / float64(leverage)
	mmPercent := 0.5 // maintenance margin percent

	if side == PositionTypeLong {
		return entryPrice * (1 - liqPercent + mmPercent)
	}
	return entryPrice * (1 + liqPercent - mmPercent)
}

func (fm *FuturesManager) ClosePosition(positionID string, closePrice float64) error {
	return errors.New("futures position closing unavailable: canonical matching and settlement services are not configured")
}

func (fm *FuturesManager) UpdateMarkPrices() {
	// Mark prices must be supplied by a verified index/oracle feed.
	return
}

func (fm *FuturesManager) GetUserPositions(userID string) []*FuturesPosition {
	fm.mu.RLock()
	defer fm.mu.RUnlock()

	userPositions, exists := fm.userPositions[userID]
	if !exists {
		return nil
	}

	positions := make([]*FuturesPosition, 0, len(userPositions))
	for _, pos := range userPositions {
		positions = append(positions, pos)
	}
	return positions
}

func (fm *FuturesManager) GetPosition(positionID string) (*FuturesPosition, error) {
	fm.mu.RLock()
	defer fm.mu.RUnlock()

	position, exists := fm.positions[positionID]
	if !exists {
		return nil, errors.New("position not found")
	}
	return position, nil
}

func (fm *FuturesManager) GetOrder(orderID string) (*FuturesOrder, error) {
	fm.mu.RLock()
	defer fm.mu.RUnlock()

	order, exists := fm.orders[orderID]
	if !exists {
		return nil, errors.New("order not found")
	}
	return order, nil
}

func (fm *FuturesManager) CancelOrder(orderID string) error {
	fm.mu.Lock()
	defer fm.mu.Unlock()

	order, exists := fm.orders[orderID]
	if !exists {
		return errors.New("order not found")
	}

	if order.Status != StatusPending {
		return errors.New("cannot cancel order")
	}

	order.Status = StatusClosed
	return nil
}

func (fm *FuturesManager) SetStopLoss(positionID string, price float64) error {
	fm.mu.Lock()
	defer fm.mu.Unlock()

	position, exists := fm.positions[positionID]
	if !exists {
		return errors.New("position not found")
	}

	position.StopLossPrice = price
	position.UpdatedAt = time.Now()
	return nil
}

func (fm *FuturesManager) SetTakeProfit(positionID string, price float64) error {
	fm.mu.Lock()
	defer fm.mu.Unlock()

	position, exists := fm.positions[positionID]
	if !exists {
		return errors.New("position not found")
	}

	position.TakeProfitPrice = price
	position.UpdatedAt = time.Now()
	return nil
}

func (fm *FuturesManager) ProcessFunding() {
	fm.mu.Lock()
	defer fm.mu.Unlock()

	now := time.Now()

	for contractID, contract := range fm.contracts {
		for _, position := range fm.positions {
			if position.ContractID != contractID || position.Status != StatusOpen {
				continue
			}

			fundingPayment := float64(0)
			if position.Side == PositionTypeLong {
				fundingPayment = -position.Margin * contract.FundingRate
			} else {
				fundingPayment = position.Margin * contract.FundingRate
			}

			payment := FundingPayment{
				ID:            fmt.Sprintf("FND%d%d", now.Unix(), now.Nanosecond()),
				UserID:        position.UserID,
				ContractID:    contractID,
				PositionSide: position.Side,
				Payment:      fundingPayment,
				FundingRate:  contract.FundingRate,
				MarkPrice:    contract.MarkPrice,
				PaidAt:       now,
			}

			position.RealizedPNL += fundingPayment

			fm.fundingHistory[position.UserID] = append(fm.fundingHistory[position.UserID], payment)
		}
	}
}

func (fm *FuturesManager) GetFundingHistory(userID string) []FundingPayment {
	fm.mu.RLock()
	defer fm.mu.RUnlock()

	return fm.fundingHistory[userID]
}

func (fm *FuturesManager) CalculateUnrealizedPNL(userID string) float64 {
	fm.mu.RLock()
	defer fm.mu.RUnlock()

	total := 0.0
	userPositions, exists := fm.userPositions[userID]
	if !exists {
		return 0
	}

	for _, pos := range userPositions {
		if pos.Status == StatusOpen {
			total += pos.UnrealizedPNL
		}
	}
	return total
}
