// Package lending provides lending and borrowing services
package lending

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"tigerex-api/internal/api"
)

var (
	ErrInsufficientCollateral = errors.New("insufficient collateral")
	ErrLiquidationRisk = errors.New("liquidation risk")
	ErrInvalidAmount = errors.New("invalid amount")
	ErrPositionNotFound = errors.New("position not found")
)

// Config holds lending configuration
type Config struct {
	MinCollateralRatio float64 // e.g., 1.5 for 150%
	LiquidationThreshold float64 // e.g., 1.2 for 120%
	MinBorrowAmount float64
	MaxBorrowAmount float64
}

// LendingProduct represents a lending market
type LendingProduct struct {
	ID                  string  `json:"id"`
	Asset              string  `json:"asset"`
	BorrowAPY          float64 `json:"borrowApy"`
	LendAPY            float64 `json:"lendApy"`
	CollateralAssets   []string `json:"collateralAssets"`
	MinAmount          float64 `json:"minAmount"`
	MaxAmount          float64 `json:"maxAmount"`
	LiquidationThreshold float64 `json:"liquidationThreshold"`
	Active             bool    `json:"active"`
}

// LendingPosition represents a lending position
type LendingPosition struct {
	ID              string    `json:"id"`
	UserID         string    `json:"userId"`
	Asset          string    `json:"asset"`
	Amount         float64   `json:"amount"`
	BorrowedAmount float64   `json:"borrowedAmount"`
	CollateralAmount float64 `json:"collateralAmount"`
	CollateralAsset string    `json:"collateralAsset"`
	APY            float64   `json:"apy"`
	InterestPaid   float64   `json:"interestPaid"`
	PositionType   string    `json:"positionType"` // "lend" or "borrow"
	Status         string    `json:"status"`
	MaturityTime   int64     `json:"maturityTime,omitempty"`
	CreatedAt      int64     `json:"createdAt"`
	UpdatedAt      int64     `json:"updatedAt"`
}

// Service handles lending operations
type Service struct {
	config   Config
	products map[string]*LendingProduct
	positions map[string]*LendingPosition
	lendPool map[string]float64 // asset -> total lent amount
	borrowPool map[string]float64 // asset -> total borrowed amount
}

func NewService(config Config) *Service {
	return &Service{
		config: config,
		products: make(map[string]*LendingProduct),
		positions: make(map[string]*LendingPosition),
		lendPool: make(map[string]float64),
		borrowPool: make(map[string]float64),
	}
}

// InitializeDefaultProducts creates default lending products
func (s *Service) InitializeDefaultProducts() {
	products := []*LendingProduct{
		{
			ID: "usdt-lend",
			Asset: "USDT",
			BorrowAPY: 12.5,
			LendAPY: 8.5,
			CollateralAssets: []string{"BTC", "ETH", "BNB"},
			MinAmount: 50,
			MaxAmount: 1000000,
			LiquidationThreshold: 1.3,
			Active: true,
		},
		{
			ID: "usdc-lend",
			Asset: "USDC",
			BorrowAPY: 11.0,
			LendAPY: 7.5,
			CollateralAssets: []string{"BTC", "ETH", "SOL"},
			MinAmount: 50,
			MaxAmount: 1000000,
			LiquidationThreshold: 1.3,
			Active: true,
		},
		{
			ID: "btc-borrow",
			Asset: "BTC",
			BorrowAPY: 6.5,
			LendAPY: 4.0,
			CollateralAssets: []string{"USDT", "USDC", "ETH"},
			MinAmount: 0.001,
			MaxAmount: 100,
			LiquidationThreshold: 1.4,
			Active: true,
		},
		{
			ID: "eth-borrow",
			Asset: "ETH",
			BorrowAPY: 8.0,
			LendAPY: 5.5,
			CollateralAssets: []string{"USDT", "USDC", "BTC"},
			MinAmount: 0.01,
			MaxAmount: 1000,
			LiquidationThreshold: 1.35,
			Active: true,
		},
	}

	for _, p := range products {
		s.products[p.ID] = p
	}
}

// GetProducts returns all lending products
func (s *Service) GetProducts() []*LendingProduct {
	result := make([]*LendingProduct, 0, len(s.products))
	for _, p := range s.products {
		if p.Active {
			result = append(result, p)
		}
	}
	return result
}

// Lend deposits funds to the lending pool
func (s *Service) Lend(ctx context.Context, userID, productID string, amount float64) (*LendingPosition, error) {
	product, ok := s.products[productID]
	if !ok {
		return nil, errors.New("product not found")
	}

	if amount < product.MinAmount {
		return nil, ErrInvalidAmount
	}

	position := &LendingPosition{
		ID: uuid.New().String(),
		UserID: userID,
		Asset: product.Asset,
		Amount: amount,
		CollateralAmount: 0,
		CollateralAsset: "",
		APY: product.LendAPY,
		PositionType: "lend",
		Status: "active",
		CreatedAt: api.Now(),
		UpdatedAt: api.Now(),
	}

	// Add to lend pool
	s.lendPool[product.Asset] += amount
	s.positions[position.ID] = position

	return position, nil
}

// Borrow takes a loan against collateral
func (s *Service) Borrow(ctx context.Context, userID, productID, collateralAsset string, borrowAmount, collateralAmount float64) (*LendingPosition, error) {
	product, ok := s.products[productID]
	if !ok {
		return nil, errors.New("product not found")
	}

	if borrowAmount < product.MinAmount || borrowAmount > product.MaxAmount {
		return nil, ErrInvalidAmount
	}

	// Check collateral ratio
	collateralValue := collateralAmount // Simplified
	borrowValue := borrowAmount // Simplified
	collateralRatio := collateralValue / borrowValue

	if collateralRatio < product.LiquidationThreshold {
		return nil, ErrInsufficientCollateral
	}

	position := &LendingPosition{
		ID: uuid.New().String(),
		UserID: userID,
		Asset: product.Asset,
		Amount: 0,
		BorrowedAmount: borrowAmount,
		CollateralAmount: collateralAmount,
		CollateralAsset: collateralAsset,
		APY: product.BorrowAPY,
		InterestPaid: 0,
		PositionType: "borrow",
		Status: "active",
		CreatedAt: api.Now(),
		UpdatedAt: api.Now(),
	}

	// Update pools
	s.borrowPool[product.Asset] += borrowAmount

	// Check liquidation risk
	if collateralRatio < s.config.LiquidationThreshold {
		position.Status = "liquidation_warning"
	}

	s.positions[position.ID] = position
	return position, nil
}

// Repay repays borrowed amount
func (s *Service) Repay(ctx context.Context, userID, positionID string, amount float64) (*LendingPosition, error) {
	position, err := s.GetPosition(userID, positionID)
	if err != nil {
		return nil, err
	}

	if position.PositionType != "borrow" {
		return nil, errors.New("not a borrow position")
	}

	if amount > position.BorrowedAmount {
		amount = position.BorrowedAmount
	}

	position.BorrowedAmount -= amount
	position.InterestPaid += amount * position.APY / 100 / 365 // Daily interest
	position.UpdatedAt = api.Now()

	// Update pool
	if s.borrowPool[position.Asset] >= amount {
		s.borrowPool[position.Asset] -= amount
	}

	if position.BorrowedAmount <= 0 {
		position.Status = "closed"
	}

	return position, nil
}

// Withdraw withdraws lent funds
func (s *Service) Withdraw(ctx context.Context, userID, positionID string, amount float64) (*LendingPosition, error) {
	position, err := s.GetPosition(userID, positionID)
	if err != nil {
		return nil, err
	}

	if position.PositionType != "lend" {
		return nil, errors.New("not a lend position")
	}

	if amount > position.Amount {
		amount = position.Amount
	}

	position.Amount -= amount
	position.UpdatedAt = api.Now()

	// Update pool
	if s.lendPool[position.Asset] >= amount {
		s.lendPool[position.Asset] -= amount
	}

	if position.Amount <= 0 {
		position.Status = "closed"
	}

	return position, nil
}

// GetPosition returns a specific position
func (s *Service) GetPosition(userID, positionID string) (*LendingPosition, error) {
	position, ok := s.positions[positionID]
	if !ok {
		return nil, ErrPositionNotFound
	}

	if position.UserID != userID {
		return nil, errors.New("unauthorized")
	}

	return position, nil
}

// GetUserPositions returns all positions for a user
func (s *Service) GetUserPositions(userID string) []*LendingPosition {
	result := make([]*LendingPosition, 0)
	for _, p := range s.positions {
		if p.UserID == userID && p.Status == "active" {
			result = append(result, p)
		}
	}
	return result
}

// GetLendAPY returns current lending APY for an asset
func (s *Service) GetLendAPY(asset string) float64 {
	totalLent := s.lendPool[asset]
	totalBorrowed := s.borrowPool[asset]

	// Calculate utilization ratio
	utilization := 0.0
	if totalLent > 0 {
		utilization = totalBorrowed / totalLent
	}

	// Find product
	for _, p := range s.products {
		if p.Asset == asset {
			// Dynamic APY based on utilization
			baseAPY := p.LendAPY
			return baseAPY * (0.5 + utilization)
		}
	}
	return 0
}

// GetBorrowAPY returns current borrowing APY for an asset
func (s *Service) GetBorrowAPY(asset string) float64 {
	totalLent := s.lendPool[asset]
	totalBorrowed := s.borrowPool[asset]

	utilization := 0.0
	if totalLent > 0 {
		utilization = totalBorrowed / totalLent
	}

	for _, p := range s.products {
		if p.Asset == asset {
			baseAPY := p.BorrowAPY
			// Higher utilization = higher borrow rate
			return baseAPY * (0.8 + utilization*0.4)
		}
	}
	return 0
}

// CalculateCollateralRatio calculates current collateral ratio for a position
func (s *Service) CalculateCollateralRatio(position *LendingPosition, collateralPrice, assetPrice float64) float64 {
	if position.PositionType != "borrow" {
		return 0
	}

	collateralValue := position.CollateralAmount * collateralPrice
	borrowValue := position.BorrowedAmount * assetPrice

	if borrowValue <= 0 {
		return 0
	}

	return collateralValue / borrowValue
}

// CheckLiquidation checks if a position should be liquidated
func (s *Service) CheckLiquidation(position *LendingPosition, collateralPrice, assetPrice float64) (bool, float64) {
	ratio := s.CalculateCollateralRatio(position, collateralPrice, assetPrice)

	product, ok := s.products[position.Asset]
	if !ok {
		return false, 0
	}

	if ratio < product.LiquidationThreshold {
		// Calculate liquidation amount (partial)
		liquidationAmount := position.BorrowedAmount * 0.25 // Liquidate 25%
		return true, liquidationAmount
	}

	return false, 0
}

// AddCollateral adds more collateral to a borrow position
func (s *Service) AddCollateral(ctx context.Context, userID, positionID string, amount float64) (*LendingPosition, error) {
	position, err := s.GetPosition(userID, positionID)
	if err != nil {
		return nil, err
	}

	if position.PositionType != "borrow" {
		return nil, errors.New("not a borrow position")
	}

	position.CollateralAmount += amount
	position.UpdatedAt = api.Now()
	position.Status = "active" // Clear warning

	return position, nil
}

// RemoveCollateral removes collateral from a borrow position
func (s *Service) RemoveCollateral(ctx context.Context, userID, positionID string, amount float64) (*LendingPosition, error) {
	position, err := s.GetPosition(userID, positionID)
	if err != nil {
		return nil, err
	}

	if position.PositionType != "borrow" {
		return nil, errors.New("not a borrow position")
	}

	// Check if removing would trigger liquidation
	tempAmount := position.CollateralAmount - amount
	// This would need asset prices to check properly
	_ = tempAmount

	position.CollateralAmount -= amount
	position.UpdatedAt = api.Now()

	return position, nil
}

// AccrueInterest accrues interest for all borrow positions
func (s *Service) AccrueInterest() {
	for _, p := range s.positions {
		if p.PositionType == "borrow" && p.Status == "active" {
			// Daily interest accrual
			dailyInterest := p.BorrowedAmount * p.APY / 36500
			p.InterestPaid += dailyInterest
			p.UpdatedAt = api.Now()
		}
	}
}

// GetPoolStats returns lending pool statistics
func (s *Service) GetPoolStats(asset string) (totalLent, totalBorrowed, lendAPY, borrowAPY float64) {
	totalLent = s.lendPool[asset]
	totalBorrowed = s.borrowPool[asset]
	lendAPY = s.GetLendAPY(asset)
	borrowAPY = s.GetBorrowAPY(asset)
	return
}