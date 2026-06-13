// Package staking provides staking and earn products
package staking

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"tigerex-api/internal/api"
)

var (
	ErrPositionNotFound = errors.New("position not found")
	ErrStakeLocked = errors.New("position locked")
	ErrInvalidAmount = errors.New("invalid amount")
)

// Config holds staking configuration
type Config struct {
	MinStakeAmount float64
	MaxStakeAmount float64
	UnbondingPeriod int64 // seconds
	EarlyUnbondFee float64 // percentage
}

// StakingProduct represents a staking product
type StakingProduct struct {
	ID             string  `json:"id"`
	Asset         string  `json:"asset"`
	Name          string  `json:"name"`
	APY           float64 `json:"apy"`
	MinStake      float64 `json:"minStake"`
	LockPeriod   int     `json:"lockPeriod"` // 0 for flexible
	Status       string  `json:"status"`
	StakeType    string  `json:"stakeType"` // "flexible", "locked", "defi"
	Network      string  `json:"network"`
	CompoundEnabled bool  `json:"compoundEnabled"`
}

// StakingPosition represents a staking position
type StakingPosition struct {
	ID             string  `json:"id"`
	UserID         string  `json:"userId"`
	ProductID     string  `json:"productId"`
	Asset         string  `json:"asset"`
	Amount        float64 `json:"amount"`
	APY           float64 `json:"apy"`
	RewardsAccrued float64 `json:"rewardsAccrued"`
	RewardsClaimed float64 `json:"rewardsClaimed"`
	CompoundEnabled bool   `json:"compoundEnabled"`
	LockEndTime   int64   `json:"lockEndTime,omitempty"`
	Status        string  `json:"status"` // "active", "unbonding", "completed"
	StartedAt     int64   `json:"startedAt"`
	UpdatedAt     int64   `json:"updatedAt"`
}

// UnbondingRequest represents an unbonding request
type UnbondingRequest struct {
	ID            string  `json:"id"`
	PositionID    string  `json:"positionId"`
	Amount        float64 `json:"amount"`
	CompleteTime  int64   `json:"completeTime"`
	Status        string  `json:"status"` // "pending", "completed"
	CreatedAt     int64   `json:"createdAt"`
}

// Service handles staking operations
type Service struct {
	config    Config
	products map[string]*StakingProduct
	positions map[string]*StakingPosition
	unbonding map[string][]*UnbondingRequest
}

func NewService(config Config) *Service {
	return &Service{
		config: config,
		products: make(map[string]*StakingProduct),
		positions: make(map[string]*StakingPosition),
		unbonding: make(map[string][]*UnbondingRequest),
	}
}

// InitializeDefaultProducts creates default staking products
func (s *Service) InitializeDefaultProducts() {
	products := []*StakingProduct{
		// ETH Staking (ETH 2.0)
		{
			ID: "eth-staking", Asset: "ETH", Name: "ETH Staking",
			APY: 4.5, MinStake: 0.01, LockPeriod: 0, Status: "active",
			StakeType: "native", Network: "Ethereum", CompoundEnabled: true,
		},
		// Liquid Staking (LSD)
		{
			ID: "steth-liquid", Asset: "STETH", Name: "stETH (Lido)",
			APY: 4.2, MinStake: 0.01, LockPeriod: 0, Status: "active",
			StakeType: "liquid", Network: "Ethereum", CompoundEnabled: true,
		},
		// DOT Staking
		{
			ID: "dot-staking", Asset: "DOT", Name: "Polkadot Staking",
			APY: 12.0, MinStake: 10, LockPeriod: 28, Status: "active",
			StakeType: "locked", Network: "Polkadot", CompoundEnabled: false,
		},
		// SOL Staking
		{
			ID: "sol-staking", Asset: "SOL", Name: "Solana Staking",
			APY: 6.5, MinStake: 1.0, LockPeriod: 0, Status: "active",
			StakeType: "native", Network: "Solana", CompoundEnabled: true,
		},
		// ATOM Staking
		{
			ID: "atom-staking", Asset: "ATOM", Name: "Cosmos Staking",
			APY: 15.0, MinStake: 1.0, LockPeriod: 21, Status: "active",
			StakeType: "locked", Network: "Cosmos", CompoundEnabled: false,
		},
		// BNB Staking
		{
			ID: "bnb-staking", Asset: "BNB", Name: "BNB Staking",
			APY: 8.0, MinStake: 0.1, LockPeriod: 0, Status: "active",
			StakeType: "defi", Network: "BNB Chain", CompoundEnabled: true,
		},
		// AVAX Staking
		{
			ID: "avax-staking", Asset: "AVAX", Name: "Avalanche Staking",
			APY: 8.5, MinStake: 25, LockPeriod: 14, Status: "active",
			StakeType: "locked", Network: "Avalanche", CompoundEnabled: false,
		},
		// MATIC Staking
		{
			ID: "matic-staking", Asset: "MATIC", Name: "Polygon Staking",
			APY: 5.0, MinStake: 100, LockPeriod: 0, Status: "active",
			StakeType: "native", Network: "Polygon", CompoundEnabled: true,
		},
		// DeFi Staking
		{
			ID: "defi-staking", Asset: "ETH", Name: "DeFi Staking",
			APY: 18.0, MinStake: 0.1, LockPeriod: 0, Status: "active",
			StakeType: "defi", Network: "Ethereum", CompoundEnabled: true,
		},
	}

	for _, p := range products {
		s.products[p.ID] = p
	}
}

// GetProducts returns all staking products
func (s *Service) GetProducts() []*StakingProduct {
	result := make([]*StakingProduct, 0, len(s.products))
	for _, p := range s.products {
		if p.Status == "active" {
			result = append(result, p)
		}
	}
	return result
}

// Stake creates a new staking position
func (s *Service) Stake(ctx context.Context, userID, productID string, amount float64, compound bool) (*StakingPosition, error) {
	product, ok := s.products[productID]
	if !ok {
		return nil, errors.New("product not found")
	}

	if amount < product.MinStake {
		return nil, ErrInvalidAmount
	}

	now := api.Now()
	lockEndTime := int64(0)
	if product.LockPeriod > 0 {
		lockEndTime = now + int64(product.LockPeriod*24*3600)
	}

	position := &StakingPosition{
		ID: uuid.New().String(),
		UserID: userID,
		ProductID: productID,
		Asset: product.Asset,
		Amount: amount,
		APY: product.APY,
		RewardsAccrued: 0,
		RewardsClaimed: 0,
		CompoundEnabled: compound,
		LockEndTime: lockEndTime,
		Status: "active",
		StartedAt: now,
		UpdatedAt: now,
	}

	s.positions[position.ID] = position
	return position, nil
}

// Unstake initiates unbonding
func (s *Service) Unstake(ctx context.Context, userID, positionID string, amount float64) (*StakingPosition, *UnbondingRequest, error) {
	position, ok := s.positions[positionID]
	if !ok {
		return nil, nil, ErrPositionNotFound
	}

	if position.UserID != userID {
		return nil, nil, errors.New("unauthorized")
	}

	if position.Status != "active" {
		return nil, nil, ErrStakeLocked
	}

	// Check lock period
	if position.LockEndTime > api.Now() {
		return nil, nil, ErrStakeLocked
	}

	if amount > position.Amount {
		amount = position.Amount
	}

	// Create unbonding request
	unbonding := &UnbondingRequest{
		ID: uuid.New().String(),
		PositionID: positionID,
		Amount: amount,
		CompleteTime: api.Now() + s.config.UnbondingPeriod,
		Status: "pending",
		CreatedAt: api.Now(),
	}

	// Update position
	position.Amount -= amount
	position.UpdatedAt = api.Now()

	if position.Amount <= 0 {
		position.Status = "completed"
	}

	// Add to unbonding queue
	s.unbonding[userID] = append(s.unbonding[userID], unbonding)

	return position, unbonding, nil
}

// ClaimRewards claims staking rewards
func (s *Service) ClaimRewards(ctx context.Context, userID, positionID string) (float64, error) {
	position, ok := s.positions[positionID]
	if !ok {
		return 0, ErrPositionNotFound
	}

	if position.UserID != userID {
		return 0, errors.New("unauthorized")
	}

	rewards := position.RewardsAccrued
	position.RewardsClaimed += rewards
	position.RewardsAccrued = 0
	position.UpdatedAt = api.Now()

	return rewards, nil
}

// GetPosition returns a staking position
func (s *Service) GetPosition(userID, positionID string) (*StakingPosition, error) {
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
func (s *Service) GetUserPositions(userID string) []*StakingPosition {
	result := make([]*StakingPosition, 0)
	for _, p := range s.positions {
		if p.UserID == userID && p.Status == "active" {
			result = append(result, p)
		}
	}
	return result
}

// CalculateRewards calculates accrued rewards
func (s *Service) CalculateRewards(position *StakingPosition) float64 {
	if position.Status != "active" {
		return 0
	}

	elapsed := float64(api.Now() - position.StartedAt) / float64(24*3600*1000) // days
	rewards := position.Amount * position.APY / 100 * elapsed / 365

	return rewards
}

// AccrueRewards updates rewards for all active positions
func (s *Service) AccrueRewards() {
	for _, position := range s.positions {
		if position.Status == "active" {
			rewards := s.CalculateRewards(position)
			position.RewardsAccrued = rewards
			position.UpdatedAt = api.Now()

			// Auto-compound if enabled
			if position.CompoundEnabled && rewards > 0 {
				position.Amount += rewards
				position.RewardsAccrued = 0
			}
		}
	}
}

// ProcessUnbonding processes completed unbonding requests
func (s *Service) ProcessUnbonding() {
	now := api.Now()

	for userID, requests := range s.unbonding {
		var remaining []*UnbondingRequest

		for _, req := range requests {
			if now >= req.CompleteTime {
				req.Status = "completed"

				// Find and update position
				if position, ok := s.positions[req.PositionID]; ok {
					position.Status = "completed"
				}
			} else {
				remaining = append(remaining, req)
			}
		}

		s.unbonding[userID] = remaining
	}
}

// GetUnbondingRequests returns unbonding requests for a user
func (s *Service) GetUnbondingRequests(userID string) []*UnbondingRequest {
	return s.unbonding[userID]
}

// GetStakingAPY returns APY for a product
func (s *Service) GetStakingAPY(productID string) float64 {
	if product, ok := s.products[productID]; ok {
		return product.APY
	}
	return 0
}

// GetTotalStaked returns total staked amount for an asset
func (s *Service) GetTotalStaked(asset string) float64 {
	var total float64
	for _, p := range s.positions {
		if p.Asset == asset && p.Status == "active" {
			total += p.Amount
		}
	}
	return total
}

// GetValidatorInfo returns validator delegation info
type ValidatorInfo struct {
	ValidatorAddress string  `json:"validatorAddress"`
	Commission     float64 `json:"commission"`
	Uptime        float64 `json:"uptime"`
	Delegators    int     `json:"delegators"`
	TotalStaked  float64 `json:"totalStaked"`
}

// GetValidators returns available validators
func (s *Service) GetValidators(network string) []*ValidatorInfo {
	// Placeholder - in production would query actual validators
	validators := []*ValidatorInfo{
		{
			ValidatorAddress: "val1.tigerex.io",
			Commission: 5.0,
			Uptime: 99.9,
			Delegators: 10000,
			TotalStaked: 1000000,
		},
		{
			ValidatorAddress: "val2.tigerex.io",
			Commission: 7.0,
			Uptime: 99.5,
			Delegators: 8000,
			TotalStaked: 800000,
		},
	}
	return validators
}