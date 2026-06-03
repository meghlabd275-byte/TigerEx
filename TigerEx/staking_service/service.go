package staking

import (
	"fmt"
	"sync"
	"time"
)

// =============================================================================
// STAKING SERVICE
// Proof-of-Stake delegation and rewards
// =============================================================================

// StakePool represents a staking pool
type StakePool struct {
	ID           string    `json:"id"`
	Asset        string    `json:"asset"`
	Name         string    `json:"name"`
	RewardAPY   float64   `json:"rewardApy"` // Annual percentage yield
	LockPeriod  int       `json:"lockPeriod"` // days
	MinStake    float64   `json:"minStake"`
	MaxStake    float64   `json:"maxStake"`
	IsFlexible  bool      `json:"isFlexible"` // flexible or locked
	TotalStaked float64   `json:"totalStaked"`
	Stakers     int64     `json:"stakers"`
	Status      string    `json:"status"` // ACTIVE, PAUSED, CLOSED
}

// Stake represents a stake position
type Stake struct {
	ID          string    `json:"id"`
	UserID     string    `json:"userId"`
	PoolID     string    `json:"poolId"`
	Amount     float64   `json:"amount"`
	RewardDebt float64   `json:"rewardDebt"` // pending rewards
	StartedAt  time.Time `json:"startedAt"`
	UnlockAt   *time.Time `json:"_unlockAt,omitempty"` // for locked stakes
	IsUnlocking bool    `json:"isUnlocking"`
	Status     string   `json:"status"` // STAKING, UNLOCKING, CLAIMED
}

// Delegation represents validator delegation
type Delegation struct {
	ID          string    `json:"id"`
	UserID      string    `json:"userId"`
	Validator  string    `json:"validator"`
	Amount     float64   `json:"amount"`
	Commission float64   `json:"commission"` // Validator commission %
	Rewards    float64   `json:"rewards"`
	DelegatedAt time.Time `json:"delegatedAt"`
}

// RewardDistribution represents reward distribution
type RewardDistribution struct {
	PoolID     string    `json:"poolId"`
	Amount     float64   `json:"amount"`
	DistributedAt time.Time `json:"distributedAt"`
	StakersCount int64   `json:"stakersCount"`
}

// Service staking service
type Service struct {
	mu sync.RWMutex

	// Pools
	pools map[string]*StakePool

	// Stakes
	stakes map[string]*Stake
	userStakes map[string]map[string]*Stake // userID -> poolID -> Stake

	// Delegations
	delegations map[string]*Delegation
	userDelegations map[string]map[string]*Delegation

	// Rewards
	rewardDistributions map[string][]*RewardDistribution

	// Config
	ClaimIntervalHours int
	UnstakingDays int
	DefaultAPY float64
}

// NewService creates staking service
func NewService() *Service {
	return &Service{
		pools:            make(map[string]*StakePool),
		stakes:          make(map[string]*Stake),
		userStakes:       make(map[string]map[string]*Stake),
		delegations:     make(map[string]*Delegation),
		userDelegations: make(map[string]map[string]*Delegation),
		rewardDistributions: make(map[string][]*RewardDistribution),
		ClaimIntervalHours: 1,
		UnstakingDays:    7,
		DefaultAPY:      5.0,
	}
}

// CreatePool creates staking pool
func (s *Service) CreatePool(pool *StakePool) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if pool.ID == "" || pool.Asset == "" {
		return fmt.Errorf("invalid pool")
	}

	if pool.RewardAPY < 0 || pool.RewardAPY > 100 {
		return fmt.Errorf("invalid APY")
	}

	if pool.MinStake <= 0 {
		pool.MinStake = 10
	}

	if pool.Status == "" {
		pool.Status = "ACTIVE"
	}

	s.pools[pool.ID] = pool

	return nil
}

// GetPools gets active pools
func (s *Service) GetPools(asset string) []*StakePool {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*StakePool
	for _, pool := range s.pools {
		if pool.Status != "ACTIVE" {
			continue
		}
		if asset != "" && pool.Asset != asset {
			continue
		}
		result = append(result, pool)
	}

	return result
}

// Stake stakes assets
func (s *Service) Stake(userID, poolID string, amount float64) (*Stake, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	pool, ok := s.pools[poolID]
	if !ok {
		return nil, fmt.Errorf("pool not found")
	}

	if pool.Status != "ACTIVE" {
		return nil, fmt.Errorf("pool not active")
	}

	if amount < pool.MinStake {
		return nil, fmt.Errorf("minimum stake: %.2f", pool.MinStake)
	}

	if pool.MaxStake > 0 && pool.TotalStaked+amount > pool.MaxStake {
		return nil, fmt.Errorf("exceeds pool capacity")
	}

	// Check existing stake
	key := fmt.Sprintf("%s-%s", userID, poolID)
	existingStake := s.stakes[key]
	if existingStake != nil && existingStake.Status == "STAKING" {
		// Add to existing
		existingStake.Amount += amount
		pool.TotalStaked += amount
		stake := existingStake
		return stake, nil
	}

	// Check lock period
	var unlockAt *time.Time
	if !pool.IsFlexible {
		unlockTime := time.Now().Add(time.Duration(pool.LockPeriod) * 24 * time.Hour)
		unlockAt = &unlockTime
	}

	stake := &Stake{
		ID:         generateID(),
		UserID:    userID,
		PoolID:    poolID,
		Amount:    amount,
		StartedAt: time.Now(),
		UnlockAt:  unlockAt,
		Status:   "STAKING",
	}

	s.stakes[key] = stake
	pool.TotalStaked += amount
	pool.Stakers++

	// Update user stakes index
	if s.userStakes[userID] == nil {
		s.userStakes[userID] = make(map[string]*Stake)
	}
	s.userStakes[userID][key] = stake

	return stake, nil
}

// Unstake initiates unstake
func (s *Service) Unstake(userID, poolID string, amount float64) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	key := fmt.Sprintf("%s-%s", userID, poolID)
	stake, ok := s.stakes[key]
	if !ok {
		return fmt.Errorf("no stake found")
	}

	if stake.Status != "STAKING" {
		return fmt.Errorf("not staked")
	}

	// Check pool lock status
	pool := s.pools[poolID]
	if !pool.IsFlexible && stake.UnlockAt != nil && time.Now().Before(*stake.UnlockAt) {
		return fmt.Errorf("still in lock period")
	}

	if amount > stake.Amount {
		return fmt.Errorf("insufficient stake")
	}

	stake.Amount -= amount
	stake.IsUnlocking = true
	stake.Status = "UNLOCKING"

	// Unlock after unbonding period
	unlockTime := time.Now().Add(time.Duration(s.UnstakingDays) * 24 * time.Hour)
	stake.UnlockAt = &unlockTime

	pool.TotalStaked -= amount

	return nil
}

// Claim claims accumulated rewards
func (s *Service) Claim(userID, poolID string) (float64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	key := fmt.Sprintf("%s-%s", userID, poolID)
	stake, ok := s.stakes[key]
	if !ok {
		return 0, fmt.Errorf("no stake found")
	}

	// Calculate pending rewards
	pool := s.pools[poolID]
	dailyReward := (stake.Amount * pool.RewardAPY / 365)
	hoursStaked := time.Since(stake.StartedAt).Hours()
	rewardDec := dailyReward * (hoursStaked / 24)

	stake.RewardDebt += rewardDec
	stake.StartedAt = time.Now()

	return stake.RewardDebt, nil
}

// CalculatePendingRewards calculates pending rewards
func (s *Service) CalculatePendingRewards(userID, poolID string) float64 {
	s.mu.RLock()
	defer s.mu.RUnlock()

	key := fmt.Sprintf("%s-%s", userID, poolID)
	stake, ok := s.stakes[key]
	if !ok {
		return 0
	}

	pool := s.pools[poolID]
	dailyReward := (stake.Amount * pool.RewardAPY / 365)
	hoursStaked := time.Since(stake.StartedAt).Hours()

	return dailyReward * (hoursStaked / 24)
}

// GetStake gets stake position
func (s *Service) GetStake(userID, poolID string) (*Stake, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	key := fmt.Sprintf("%s-%s", userID, poolID)
	stake, ok := s.stakes[key]
	if !ok {
		return nil, fmt.Errorf("no stake found")
	}

	return stake, nil
}

// GetUserStakes gets all stakes for user
func (s *Service) GetUserStakes(userID string) []*Stake {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*Stake
	for _, stake := range s.stakes {
		if stake.UserID == userID && stake.Status == "STAKING" {
			result = append(result, stake)
		}
	}

	return result
}

// GetTotalStaked gets total staked amount
func (s *Service) GetTotalStaked(userID string) float64 {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var total float64
	for _, stake := range s.stakes {
		if stake.UserID == userID && stake.Status == "STAKING" {
			total += stake.Amount
		}
	}

	return total
}

// GetTotalRewards gets total claimed rewards
func (s *Service) GetTotalRewards(userID string) float64 {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var total float64
	for _, stake := range s.stakes {
		if stake.UserID == userID {
			total += stake.RewardDebt
		}
	}

	return total
}

// Delegate delegates to validator
func (s *Service) Delegate(userID, validator string, amount float64) (*Delegation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if amount < 100 {
		return nil, fmt.Errorf("minimum delegation: 100")
	}

	delegation := &Delegation{
		ID:         generateID(),
		UserID:    userID,
		Validator: validator,
		Amount:   amount,
		DelegatedAt: time.Now(),
	}

	s.delegations[delegation.ID] = delegation

	if s.userDelegations[userID] == nil {
		s.userDelegations[userID] = make(map[string]*Delegation)
	}
	s.userDelegations[userID][delegation.ID] = delegation

	return delegation, nil
}

// Undelegate undelegates
func (s *Service) Undelegate(delegationID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	delegation, ok := s.delegations[delegationID]
	if !ok {
		return fmt.Errorf("delegation not found")
	}

	// Unbond period simulation - immediately mark for unbonding
	delegation.Amount = 0

	return nil
}

// GetValidators gets supported validators
func (s *Service) GetValidators() []string {
	// Return mock validators - production would query chain
	return []string{
		"eth2-mainnet-01",
		"cosmoshub-4",
		"solana-mainnet",
		"cardano-mainnet",
		"polkadot-mainnet",
	}
}

func generateID() string {
	return fmt.Sprintf("stk-%d", time.Now().UnixNano())
}

func timeSince(t time.Time) time.Duration {
	return time.Since(t)
}

func min(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}