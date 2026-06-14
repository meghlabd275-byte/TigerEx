package main

import (
	"fmt"
	"sync"
	"time"
)

// ============================================================================
// STAKING & LSD (LIQUID STAKING DERIVATIVES)
// ETH 2.0 Staking and Liquid Staking Token implementation
// ============================================================================

// ============================================================================
// TYPES
// ============================================================================

// Stake represents a staking position
type Stake struct {
	ID          string
	UserID      string
	Asset      string
	Amount     float64
	Reward     float64
	Duration   int // days
	LockedUntil time.Time
	Status    StakeStatus
	CreatedAt time.Time
}

type StakeStatus string

const (
	StakeStatusActive   StakeStatus = "ACTIVE"
	StakeStatusUnstaking StakeStatus = "UNSTAKING"
	StakeStatusClaimed StakeStatus = "CLAIMED"
)

// LSDToken represents a liquid staking derivative token
type LSDToken struct {
	Symbol          string
	Name           string
	StakedAsset   string
	ExchangeRate  float64 // stAsset per 1 base asset
	TotalStaked  float64
	TotalSupply  float64
	APY          float64
	MinStake     float64
	UnbondingPeriod int // days
}

// UnbondingRequest represents an unbonding request
type UnbondingRequest struct {
	ID        string
	StakeID  string
	UserID   string
	Amount   float64
	AvailableAt time.Time
	Status  UnbondingStatus
}

type UnbondingStatus string

const (
	UnbondingStatusPending   UnbondingStatus = "PENDING"
	UnbondingStatusClaimable UnbondingStatus = "CLAIMABLE"
	UnbondingStatusClaimed  UnbondingStatus = "CLAIMED"
)

// ============================================================================
// SERVICE
// ============================================================================

// StakingService manages staking
type StakingService struct {
	mu          sync.RWMutex
	stakes     map[string]*Stake
	lsdTokens  map[string]*LSDToken
	unbondings map[string]*UnbondingRequest
	stakeCounter int64
}

func NewStakingService() *StakingService {
	s := &StakingService{
		stakes:     make(map[string]*Stake),
		lsdTokens:  make(map[string]*LSDToken),
		unbondings: make(map[string]*UnbondingRequest),
	}
	
	// Initialize LSD tokens
	s.initLSDTokens()
	
	return s
}

func (s *StakingService) initLSDTokens() {
	// ETH liquid staking
	s.lsdTokens["stETH"] = &LSDToken{
		Symbol:         "stETH",
		Name:          "Staked ETH",
		StakedAsset:   "ETH",
		ExchangeRate:  1.05, // 5% staking yield
		TotalStaked:  1_000_000,
		TotalSupply:  1_050_000,
		APY:          5.0,
		MinStake:     0.01,
		UnbondingPeriod: 5,
	}
	
	// BNB liquid staking
	s.lsdTokens["stBNB"] = &LSDToken{
		Symbol:         "stBNB",
		Name:          "Staked BNB",
		StakedAsset:   "BNB",
		ExchangeRate:  1.08,
		TotalStaked:  500_000,
		TotalSupply:  540_000,
		APY:          8.0,
		MinStake:     0.1,
		UnbondingPeriod: 7,
	}
	
	// SOL liquid staking
	s.lsdTokens["stSOL"] = &LSDToken{
		Symbol:         "stSOL",
		Name:          "Staked SOL",
		StakedAsset:   "SOL",
		ExchangeRate:  1.12,
		TotalStaked:  2_000_000,
		TotalSupply:  2_240_000,
		APY:          12.0,
		MinStake:     1.0,
		UnbondingPeriod: 3,
	}
}

// ============================================================================
// STAKING OPERATIONS
// ============================================================================

// Stake stakes assets
func (s *StakingService) Stake(userID, asset, symbol string, amount float64, duration int) (*Stake, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	// Validate LSD token
	token, ok := s.lsdTokens[symbol]
	if !ok {
		return nil, fmt.Errorf("LSD token not found: %s", symbol)
	}
	
	// Check minimum
	if amount < token.MinStake {
		return nil, fmt.Errorf("below minimum stake: %.4f", token.MinStake)
	}
	
	// Calculate LSD tokens received
	lsdAmount := amount * token.ExchangeRate
	
	// Create stake
	s.stakeCounter++
	stake := &Stake{
		ID:          fmt.Sprintf("STAKE%d", s.stakeCounter),
		UserID:      userID,
		Asset:       symbol,
		Amount:      lsdAmount,
		Duration:    duration,
		LockedUntil: time.Now().Add(time.Duration(duration) * 24 * time.Hour),
		Status:     StakeStatusActive,
		CreatedAt: time.Now(),
	}
	
	s.stakes[stake.ID] = stake
	
	// Update token stats
	token.TotalStaked += amount
	token.TotalSupply += lsdAmount
	
	return stake, nil
}

// Unstake initiates unbonding
func (s *StakingService) Unstake(stakeID string) (*UnbondingRequest, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	stake, ok := s.stakes[stakeID]
	if !ok {
		return nil, fmt.Errorf("stake not found")
	}
	
	if stake.Status != StakeStatusActive {
		return nil, fmt.Errorf("stake not active")
	}
	
	// Get token
	token, ok := s.lsdTokens[stake.Asset]
	if !ok {
		return nil, fmt.Errorf("token not found")
	}
	
	// Calculate base asset to receive
	baseAmount := stake.Amount / token.ExchangeRate
	
	// Create unbonding request
	unbonding := &UnbondingRequest{
		ID:         fmt.Sprintf("UNBOND%d", s.stakeCounter),
		StakeID:   stakeID,
		UserID:    stake.UserID,
		Amount:    baseAmount,
		AvailableAt: time.Now().Add(time.Duration(token.UnbondingPeriod) * 24 * time.Hour),
		Status:    UnbondingStatusPending,
	}
	
	s.unbondings[unbonding.ID] = unbonding
	
	// Update stake
	stake.Status = StakeStatusUnstaking
	
	// Update token
	token.TotalStaked -= baseAmount
	token.TotalSupply -= stake.Amount
	
	return unbonding, nil
}

// Claim claims unbonded assets
func (s *StakingService) Claim(unbondingID string) (float64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	unbonding, ok := s.unbondings[unbondingID]
	if !ok {
		return 0, fmt.Errorf("unbonding not found")
	}
	
	if unbonding.Status != UnbondingStatusClaimable {
		return 0, fmt.Errorf("not yet claimable")
	}
	
	unbonding.Status = UnbondingStatusClaimed
	
	return unbonding.Amount, nil
}

// ClaimStake claims staking rewards
func (s *StakingService) ClaimStake(stakeID string) (float64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	stake, ok := s.stakes[stakeID]
	if !ok {
		return 0, fmt.Errorf("stake not found")
	}
	
	if stake.Status != StakeStatusActive {
		return 0, fmt.Errorf("stake not active")
	}
	
	reward := stake.Reward
	stake.Reward = 0
	stake.Status = StakeStatusClaimed
	
	return reward, nil
}

// GetStake gets stake by ID
func (s *StakingService) GetStake(stakeID string) (*Stake, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	stake, ok := s.stakes[stakeID]
	if !ok {
		return nil, fmt.Errorf("stake not found")
	}
	
	return stake, nil
}

// GetUserStakes gets all stakes for a user
func (s *StakingService) GetUserStakes(userID string) []*Stake {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	var result []*Stake
	for _, stake := range s.stakes {
		if stake.UserID == userID {
			result = append(result, stake)
		}
	}
	
	return result
}

// GetLSDToken gets LSD token info
func (s *StakingService) GetLSDToken(symbol string) (*LSDToken, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	token, ok := s.lsdTokens[symbol]
	if !ok {
		return nil, fmt.Errorf("token not found")
	}
	
	return token, nil
}

// GetAllLSDTokens gets all LSD tokens
func (s *StakingService) GetAllLSDTokens() []*LSDToken {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	result := make([]*LSDToken, 0, len(s.lsdTokens))
	for _, token := range s.lsdTokens {
		result = append(result, token)
	}
	
	return result
}

// UpdateRewards updates staking rewards (called by reward distribution)
func (s *StakingService) UpdateRewards() {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	for _, stake := range s.stakes {
		if stake.Status == StakeStatusActive {
			// Calculate daily reward (simplified)
			dailyReward := stake.Amount * 0.05 / 365
			stake.Reward += dailyReward
		}
	}
	
	// Update unbonding availability
	now := time.Now()
	for _, unbonding := range s.unbondings {
		if unbonding.Status == UnbondingStatusPending && now.After(unbonding.AvailableAt) {
			unbonding.Status = UnbondingStatusClaimable
		}
	}
}

// ============================================================================
// EXAMPLE
// ============================================================================

func main() {
	fmt.Println("TigerEx Staking & LSD v1.0.0")
	
	staking := NewStakingService()
	
	// Get available tokens
	tokens := staking.GetAllLSDTokens()
	fmt.Println("Available LSD Tokens:")
	for _, t := range tokens {
		fmt.Printf("  %s: %.2f%% APY, Rate: %.4f\n", t.Symbol, t.APY, t.ExchangeRate)
	}
	
	// Stake ETH
	stake, err := staking.Stake("user1", "ETH", "stETH", 10.0, 30)
	if err != nil {
		fmt.Println("Error:", err)
		return
	}
	
	fmt.Printf("Staked: %s, Amount: %.4f %s\n", stake.ID, stake.Amount, stake.Asset)
	
	// Unstake
	unbonding, _ := staking.Unstake(stake.ID)
	fmt.Printf("Unbonding: %s, Available: %s\n", unbonding.ID, unbonding.AvailableAt)
}