// TigerEx Margin Trading Service
// Leveraged trading with margin accounts

package margin

import (
	"errors"
	"fmt"
	"sync"
	"time"
)

const (
	StatusOpen    = "open"
	StatusClosed  = "closed"
	StatusLiquidated = "liquidated"

	PositionSideLong  = "long"
	PositionSideShort = "short"

	MarginTypeIsolated = "isolated"
	MarginTypeCross    = "cross"
)

type MarginAccount struct {
	UserID          string    `json:"user_id"`
	TotalBalance    float64   `json:"total_balance"`
	AvailableMargin float64   `json:"available_margin"`
	UsedMargin     float64   `json:"used_margin"`
	UnrealizedPNL float64   `json:"unrealized_pnl"`
	TotalLeverage  float64   `json:"total_leverage"`
	RiskLevel      string    `json:"risk_level"`
	LiquidationPrice float64  `json:"liquidation_price"`
	LastUpdated    time.Time `json:"last_updated"`
}

type MarginPosition struct {
	ID              string    `json:"id"`
	UserID          string    `json:"user_id"`
	Symbol          string    `json:"symbol"`
	Side            string    `json:"side"`
	MarginType      string    `json:"margin_type"`
	Leverage        int       `json:"leverage"`
	EntryPrice     float64   `json:"entry_price"`
	MarkPrice      float64   `json:"mark_price"`
	Amount          float64   `json:"amount"`
	Margin          float64   `json:"margin"`
	UnrealizedPNL  float64   `json:"unrealized_pnl"`
	RealizedPNL    float64   `json:"realized_pnl"`
	LiquidationPrice float64  `json:"liquidation_price"`
	StopLossPrice  float64   `json:"stop_loss_price"`
	TakeProfitPrice float64  `json:"take_profit_price"`
	Status          string    `json:"status"`
	OpenedAt       time.Time `json:"opened_at"`
	UpdatedAt       time.Time `json:"updated_at"`
	ClosedAt        time.Time `json:"closed_at"`
}

type LiquidationOrder struct {
	ID            string    `json:"id"`
	UserID        string    `json:"user_id"`
	PositionID   string    `json:"position_id"`
	Symbol        string    `json:"symbol"`
	Side          string    `json:"side"`
	Amount        float64   `json:"amount"`
	Price         float64   `json:"price"`
	LiquidationFee float64   `json:"liquidation_fee"`
	Status        string    `json:"status"`
	CreatedAt    time.Time `json:"created_at"`
}

type MarginManager struct {
	mu          sync.RWMutex
	accounts    map[string]*MarginAccount
	positions   map[string]*MarginPosition
	userPositions map[string]map[string]*MarginPosition
	liquidations map[string]*LiquidationOrder
}

func NewMarginManager() *MarginManager {
	return &MarginManager{
		accounts:       make(map[string]*MarginAccount),
		positions:      make(map[string]*MarginPosition),
		userPositions:  make(map[string]map[string]*MarginPosition),
		liquidations:  make(map[string]*LiquidationOrder),
	}
}

func (mm *MarginManager) GetOrCreateAccount(userID string) (*MarginAccount, error) {
	mm.mu.Lock()
	defer mm.mu.Unlock()

	account, exists := mm.accounts[userID]
	if !exists {
		account = &MarginAccount{
			UserID:          userID,
			TotalBalance:    0,
			AvailableMargin: 0,
			UsedMargin:      0,
			UnrealizedPNL:  0,
			TotalLeverage:   0,
			RiskLevel:      "safe",
			LiquidationPrice: 0,
			LastUpdated:     time.Now(),
		}
		mm.accounts[userID] = account
	}
	return account, nil
}

func (mm *MarginManager) OpenPosition(userID, symbol, side, marginType string, amount, entryPrice float64, leverage int) (*MarginPosition, error) {
	if leverage < 1 || leverage > 125 {
		return nil, errors.New("leverage must be between 1 and 125")
	}

	if amount <= 0 || entryPrice <= 0 {
		return nil, errors.New("invalid amount or price")
	}

	account, err := mm.GetOrCreateAccount(userID)
	if err != nil {
		return nil, err
	}

	mm.mu.Lock()
	defer mm.mu.Unlock()

	marginRequired := (amount * entryPrice) / float64(leverage)

	if account.AvailableMargin < marginRequired {
		return nil, errors.New("insufficient margin")
	}

	now := time.Now()
	position := &MarginPosition{
		ID:              fmt.Sprintf("MGN%d%d", now.Unix(), now.Nanosecond()),
		UserID:          userID,
		Symbol:          symbol,
		Side:            side,
		MarginType:      marginType,
		Leverage:        leverage,
		EntryPrice:      entryPrice,
		MarkPrice:       entryPrice,
		Amount:          amount,
		Margin:          marginRequired,
		UnrealizedPNL:   0,
		RealizedPNL:     0,
		LiquidationPrice: mm.calculateLiquidationPrice(entryPrice, leverage, side),
		StopLossPrice:    0,
		TakeProfitPrice:  0,
		Status:          StatusOpen,
		OpenedAt:        now,
		UpdatedAt:       now,
	}

	mm.positions[position.ID] = position

	if _, ok := mm.userPositions[userID]; !ok {
		mm.userPositions[userID] = make(map[string]*MarginPosition)
	}
	mm.userPositions[userID][position.ID] = position

	account.UsedMargin += marginRequired
	account.AvailableMargin -= marginRequired
	account.LastUpdated = now

	return position, nil
}

func (mm *MarginManager) calculateLiquidationPrice(entryPrice float64, leverage int, side string) float64 {
	liqPercent := 1.0 / float64(leverage)
	if side == PositionSideLong {
		return entryPrice * (1 - liqPercent)
	}
	return entryPrice * (1 + liqPercent)
}

func (mm *MarginManager) ClosePosition(positionID string, closePrice float64) error {
	mm.mu.Lock()
	defer mm.mu.Unlock()

	position, exists := mm.positions[positionID]
	if !exists {
		return errors.New("position not found")
	}

	if position.Status != StatusOpen {
		return errors.New("position is not open")
	}

	now := time.Now()

	var pnl float64
	if position.Side == PositionSideLong {
		pnl = (closePrice - position.EntryPrice) * position.Amount
	} else {
		pnl = (position.EntryPrice - closePrice) * position.Amount
	}

	position.UnrealizedPNL = pnl
	position.MarkPrice = closePrice
	position.RealizedPNL += pnl
	position.Status = StatusClosed
	position.ClosedAt = now

	account, exists := mm.accounts[position.UserID]
	if exists {
		account.UsedMargin -= position.Margin
		account.AvailableMargin += position.Margin
		account.UnrealizedPNL += pnl
		account.TotalBalance += pnl
		account.LastUpdated = now
	}

	return nil
}

func (mm *MarginManager) AddMargin(positionID string, marginAmount float64) error {
	mm.mu.Lock()
	defer mm.mu.Unlock()

	position, exists := mm.positions[positionID]
	if !exists {
		return errors.New("position not found")
	}

	account, exists := mm.accounts[position.UserID]
	if !exists {
		return errors.New("account not found")
	}

	if account.AvailableMargin < marginAmount {
		return errors.New("insufficient account margin")
	}

	position.Margin += marginAmount
	account.UsedMargin += marginAmount
	account.AvailableMargin -= marginAmount
	position.UpdatedAt = time.Now()

	position.LiquidationPrice = mm.calculateLiquidationPrice(position.EntryPrice, position.Leverage, position.Side)

	return nil
}

func (mm *MarginManager) SetStopLoss(positionID string, price float64) error {
	mm.mu.Lock()
	defer mm.mu.Unlock()

	position, exists := mm.positions[positionID]
	if !exists {
		return errors.New("position not found")
	}

	if price <= 0 {
		return errors.New("invalid stop loss price")
	}

	position.StopLossPrice = price
	position.UpdatedAt = time.Now()

	return nil
}

func (mm *MarginManager) SetTakeProfit(positionID string, price float64) error {
	mm.mu.Lock()
	defer mm.mu.Unlock()

	position, exists := mm.positions[positionID]
	if !exists {
		return errors.New("position not found")
	}

	if price <= 0 {
		return errors.New("invalid take profit price")
	}

	position.TakeProfitPrice = price
	position.UpdatedAt = time.Now()

	return nil
}

func (mm *MarginManager) UpdateMarkPrice(symbol string, markPrice float64) ([]*MarginPosition, error) {
	mm.mu.Lock()
	defer mm.mu.Unlock()

	var toLiquidate []*MarginPosition

	for _, pos := range mm.positions {
		if pos.Symbol != symbol || pos.Status != StatusOpen {
			continue
		}

		pos.MarkPrice = markPrice

		var pnl float64
		if pos.Side == PositionSideLong {
			pnl = (markPrice - pos.EntryPrice) * pos.Amount
		} else {
			pnl = (pos.EntryPrice - markPrice) * pos.Amount
		}

		pos.UnrealizedPNL = pnl

		if markPrice <= pos.LiquidationPrice || markPrice >= pos.LiquidationPrice {
			toLiquidate = append(toLiquidate, pos)
		}

		account, exists := mm.accounts[pos.UserID]
		if exists {
			account.UnrealizedPNL = 0
			for _, p := range mm.userPositions[pos.UserID] {
				if p.Status == StatusOpen {
					account.UnrealizedPNL += p.UnrealizedPNL
				}
			}
		}

		pos.UpdatedAt = time.Now()
	}

	return toLiquidate, nil
}

func (mm *MarginManager) LiquidatePosition(positionID string) error {
	mm.mu.Lock()
	defer mm.mu.Unlock()

	position, exists := mm.positions[positionID]
	if !exists {
		return errors.New("position not found")
	}

	now := time.Now()

	liquidationFee := position.Margin * 0.01

	position.Status = StatusLiquidated
	position.ClosedAt = now

	account, exists := mm.accounts[position.UserID]
	if exists {
		account.UsedMargin -= position.Margin
		account.UnrealizedPNL -= position.Margin
		account.TotalBalance -= liquidationFee
		account.LastUpdated = now
	}

	liquidation := &LiquidationOrder{
		ID:             fmt.Sprintf("LIQ%d%d", now.Unix(), now.Nanosecond()),
		UserID:         position.UserID,
		PositionID:    positionID,
		Symbol:         position.Symbol,
		Side:           position.Side,
		Amount:         position.Amount,
		Price:          position.MarkPrice,
		LiquidationFee: liquidationFee,
		Status:         "completed",
		CreatedAt:     now,
	}

	mm.liquidations[liquidation.ID] = liquidation

	return nil
}

func (mm *MarginManager) GetPosition(positionID string) (*MarginPosition, error) {
	mm.mu.RLock()
	defer mm.mu.RUnlock()

	position, exists := mm.positions[positionID]
	if !exists {
		return nil, errors.New("position not found")
	}
	return position, nil
}

func (mm *MarginManager) GetUserPositions(userID string) []*MarginPosition {
	mm.mu.RLock()
	defer mm.mu.RUnlock()

	userPositions, exists := mm.userPositions[userID]
	if !exists {
		return nil
	}

	positions := make([]*MarginPosition, 0, len(userPositions))
	for _, pos := range userPositions {
		positions = append(positions, pos)
	}
	return positions
}

func (mm *MarginManager) GetAccount(userID string) (*MarginAccount, error) {
	mm.mu.RLock()
	defer mm.mu.RUnlock()

	account, exists := mm.accounts[userID]
	if !exists {
		return nil, errors.New("account not found")
	}
	return account, nil
}

func (mm *MarginManager) DepositMargin(userID string, amount float64) error {
	if amount <= 0 {
		return errors.New("invalid amount")
	}

	mm.mu.Lock()
	defer mm.mu.Unlock()

	account, exists := mm.accounts[userID]
	if !exists {
		account = &MarginAccount{
			UserID:      userID,
			LastUpdated: time.Now(),
		}
		mm.accounts[userID] = account
	}

	account.TotalBalance += amount
	account.AvailableMargin += amount
	account.LastUpdated = time.Now()

	return nil
}

func (mm *MarginManager) WithdrawMargin(userID string, amount float64) error {
	if amount <= 0 {
		return errors.New("invalid amount")
	}

	mm.mu.Lock()
	defer mm.mu.Unlock()

	account, exists := mm.accounts[userID]
	if !exists {
		return errors.New("account not found")
	}

	if account.AvailableMargin < amount {
		return errors.New("insufficient available margin")
	}

	account.TotalBalance -= amount
	account.AvailableMargin -= amount
	account.LastUpdated = time.Now()

	return nil
}

func (mm *MarginManager) GetLiquidations(userID string) []*LiquidationOrder {
	mm.mu.RLock()
	defer mm.mu.RUnlock()

	var result []*LiquidationOrder
	for _, liq := range mm.liquidations {
		if liq.UserID == userID {
			result = append(result, liq)
		}
	}
	return result
}

func (mm *MarginManager) GetMaxLeverage(userID, symbol string) int {
	account, err := mm.GetAccount(userID)
	if err != nil || account.TotalBalance < 1000 {
		return 3
	}
	if account.TotalBalance < 10000 {
		return 10
	}
	return 125
}
