// Package margin_trading provides margin lending trading.
// Migrated from TypeScript to Go for leveraged trading.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Margin loan
type MarginLoan struct {
	ID          string  `json:"id"`
	UserID     string  `json:"userId"`
	Currency   string  `json:"currency"`
	Principal  float64 `json:"principal"`
	Interest   float64 `json:"interest"` // hourly rate
	Status     string  `json:"status"` // active, repaid
	BorrowedAt int64  `json:"borrowedAt"`
}

// Margin position
type MarginPosition struct {
	ID           string  `json:"id"`
	UserID      string  `json:"userId"`
	Borrowed    float64 `json:"borrowed"` // borrowed amount
	Collateral  float64 `json:"collateral"` // user's collateral
	Asset       string  `json:"asset"` // trading asset
	Leverage    float64 `json:"leverage"` // e.g., 3x
	EntryPrice  float64 `json:"entryPrice"`
	Status      string  `json:"status"` // open, liquidated
}

// Liquidation event
type Liquidation struct {
	ID         string  `json:"id"`
	PositionID string  `json:"positionId"`
	UserID    string  `json:"userId"`
	Debt      float64 `json:"debt"`
	CollateralLeft float64 `json:"collateralLeft"`
	Li价格    float64 `json:"liquidationPrice"`
	Timestamp int64   `json:"timestamp"`
}

// Store
type MarginStore struct {
	mu       sync.RWMutex
	loans    map[string]*MarginLoan
	positions map[string]*MarginPosition
	interest float64 // hourly interest rate
}

var (
	marginStore = &MarginStore{
		loans:      make(map[string]*MarginLoan),
		positions:  make(map[string]*MarginPosition),
		interest:   0.0001, // 0.01% hourly
	}
)

// Borrow funds
func Borrow(userID, currency string, amount float64, collateral float64) (*MarginLoan, error) {
	// Check collateral ratio
	minCollateral := amount * 1.5 // 150% collateral required
	if collateral < minCollateral {
		return nil, fmt.Errorf("insufficient collateral")
	}

	loan := &MarginLoan{
		ID:         fmt.Sprintf("loan_%d", time.Now().UnixNano()),
		UserID:    userID,
		Currency: currency,
		Principal: amount,
		Interest: marginStore.interest,
		Status:   "active",
		BorrowedAt: time.Now().UnixMilli(),
	}

	marginStore.mu.Lock()
	defer marginStore.mu.Unlock()
	marginStore.loans[loan.ID] = loan

	return loan, nil
}

// Repay loan
func Repay(loanID string) error {
	marginStore.mu.Lock()
	defer marginStore.mu.Unlock()

	loan, ok := marginStore.loans[loanID]
	if !ok {
		return fmt.Errorf("loan not found")
	}

	loan.Status = "repaid"
	return nil
}

// Open leveraged position
func OpenPosition(userID, asset string, borrowed, collateral, leverage, entryPrice float64) (*MarginPosition, error) {
	if leverage < 1 || leverage > 10 {
		return nil, fmt.Errorf("leverage must be 1-10x")
	}

	// Check health ratio
	positionValue := (borrowed + collateral) * leverage
	healthRatio := collateral / positionValue

	if healthRatio < 0.25 {
		return nil, fmt.Errorf("insufficient health")
	}

	position := &MarginPosition{
		ID:          fmt.Sprintf("mp_%d", time.Now().UnixNano()),
		UserID:      userID,
		Borrowed:   borrowed,
		Collateral: collateral,
		Asset:      asset,
		Leverage:    leverage,
		EntryPrice: entryPrice,
		Status:     "open",
	}

	marginStore.mu.Lock()
	defer marginStore.mu.Unlock()
	marginStore.positions[position.ID] = position

	return position, nil
}

// Calculate health ratio
func CalculateHealth(position *MarginPosition, currentPrice float64) float64 {
	marginStore.mu.RLock()
	defer marginStore.mu.RUnlock()

	// What user would receive if sold now
	notional := (position.Borrowed + position.Collateral) * position.Leverage
	positionValue := notional / position.EntryPrice * currentPrice

	// Health after paying back borrow
	equity := positionValue - position.Borrowed
	healthRatio := equity / positionValue

	return healthRatio
}

// Check liquidation
func CheckLiquidation(positionID string, currentPrice float64) (bool, float64) {
	marginStore.mu.RLock()
	defer marginStore.mu.RUnlock()

	position, ok := marginStore.positions[positionID]
	if !ok {
		return false, 0
	}

	if position.Status != "open" {
		return false, 0
	}

	health := CalculateHealth(position, currentPrice)
	liquidationThreshold := 0.10 // 10%

	return health < liquidationThreshold, health
}

// Liquidate position
func Liquidate(positionID string, currentPrice float64) (*Liquidation, error) {
	marginStore.mu.Lock()
	defer marginStore.mu.Unlock()

	position, ok := marginStore.positions[positionID]
	if !ok {
		return nil, fmt.Errorf("position not found")
	}

	// Calculate liquidation price
	marginRatio := position.Collateral / (position.Borrowed + position.Collateral)
	liquidationPrice := position.EntryPrice * marginRatio * (1.0 / position.Leverage)

	// Calculate remaining collateral
	notional := position.Borrowed + position.Collateral
	positionValue := notional / position.EntryPrice * currentPrice
	remaining := positionValue - (position.Borrowed * 1.1) // +10% for fees

	liquidation := &Liquidation{
		ID:               fmt.Sprintf("liq_%d", time.Now().UnixNano()),
		PositionID:       positionID,
		UserID:          position.UserID,
		Debt:             position.Borrowed * 1.1,
		CollateralLeft:   remaining,
		Li价格:           liquidationPrice,
		Timestamp:        time.Now().UnixMilli(),
	}

	position.Status = "liquidated"

	return liquidation, nil
}

// Calculate interest owed
func CalculateInterest(loanID string) (float64, error) {
	marginStore.mu.RLock()
	defer marginStore.mu.RUnlock()

	loan, ok := marginStore.loans[loanID]
	if !ok {
		return 0, fmt.Errorf("loan not found")
	}

	hours := float64(time.Now().UnixMilli()-loan.BorrowedAt) / 3600000
	interest := loan.Principal * loan.Interest * hours

	return interest, nil
}

func main() {
	fmt.Println("Margin Trading service initialized")

	// Borrow demo
	loan, err := Borrow("user_001", "USDT", 1000, 2000)
	if err != nil {
		fmt.Printf("Borrow error: %v\n", err)
	} else {
		fmt.Printf("Borrowed: %.2f %s\n", loan.Principal, loan.Currency)
	}

	// Open position
	position, err := OpenPosition("user_001", "BTC", 1000, 500, 3, 50000)
	if err != nil {
		fmt.Printf("Position error: %v\n", err)
	} else {
		fmt.Printf("Opened position: leverage %.1fx\n", position.Leverage)
	}

	// Check health
	healthy, health := CheckLiquidation(position.ID, 48000)
	fmt.Printf("Health: %.2f%%, Liquidatable: %v\n", health*100, healthy)
}