// Package staking provides staking services.
// Liquid staking and validator delegation.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Validator
type Validator struct {
	ID        string  `json:"id"`
	Name     string  `json:"name"`
	Address  string  `json:"address"`
	Stake    float64 `json:"stake"` // total delegated
	Commission float64 `json:"commission"` // %
	Uptime   float64 `json:"uptime"` // %
	Status   string  `json:"status"` // active, jailed, inactive
	APY      float64 `json:"apy"`
}

// Delegation
type Delegation struct {
	ID          string  `json:"id"`
	UserID     string  `json:"userId"`
	ValidatorID string  `json:"validatorId"`
	Amount    float64 `json:"amount"`
	Rewards   float64 `json:"rewards"`
	StartedAt int64   `json:"startedAt"`
	Status    string  `json:"status"` // active, undelegating
}

// Unbonding Record
type Unbonding struct {
	ID          string  `json:"id"`
	DelegationID string `json:"delegationId"`
	Amount      float64 `json:"amount"`
	CompleteAt int64   `json:"completeAt"`
	Status     string  `json:"status"` // unbonding, claimable
}

// Reward Distribution
type RewardDist struct {
	ValidatorID string  `json:"validatorId"`
	Epoch       int     `json:"epoch"`
	Reward     float64 `json:"reward"`
	Bonus      float64 `json:"bonus"`
	Timestamp  int64   `json:"timestamp"`
}

// Store
type StakingStore struct {
	mu         sync.RWMutex
	validators map[string]*Validator
	delegations map[string]*Delegation
	unbondings  map[string]*Unbonding
	rewards    map[string][]RewardDist
}

var stakeStore = &StakingStore{
	validators: make(map[string]*Validator),
	delegations: make(map[string]*Delegation),
	unbondings: make(map[string]*Unbonding),
	rewards: make(map[string][]RewardDist),
}

// Register validator
func RegisterValidator(name, address string, commission float64) *Validator {
	validator := &Validator{
		ID: fmt.Sprintf("val_%d", time.Now().UnixNano()),
		Name: name,
		Address: address,
		Stake: 0,
		Commission: commission,
		Uptime: 99.9,
		Status: "active",
		APY: 0.05,
	}

	stakeStore.mu.Lock()
	stakeStore.validators[validator.ID] = validator
	stakeStore.mu.Unlock()

	return validator
}

// Delegate to validator
func Delegate(userID, validatorID string, amount float64) (*Delegation, error) {
	stakeStore.mu.RLock()
	validator, ok := stakeStore.validators[validatorID]
	stakeStore.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("validator not found")
	}

	delegation := &Delegation{
		ID: fmt.Sprintf("del_%d", time.Now().UnixNano()),
		UserID: userID,
		ValidatorID: validatorID,
		Amount: amount,
		Rewards: 0,
		StartedAt: time.Now().UnixMilli(),
		Status: "active",
	}

	stakeStore.mu.Lock()
	stakeStore.delegations[delegation.ID] = delegation
	validator.Stake += amount
	stakeStore.mu.Unlock()

	return delegation, nil
}

// Undelegate
func Undelegate(delegationID string) (*Unbonding, error) {
	stakeStore.mu.RLock()
	delegation, ok := stakeStore.delegations[delegationID]
	stakeStore.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("delegation not found")
	}

	// 21 day unbonding period
	unbonding := &Unbonding{
		ID: fmt.Sprintf("unb_%d", time.Now().UnixNano()),
		DelegationID: delegationID,
		Amount: delegation.Amount,
		CompleteAt: time.Now().UnixMilli() + 86400000*21,
		Status: "unbonding",
	}

	stakeStore.mu.Lock()
	delegation.Status = "undelegating"
	stakeStore.unbondings[unbonding.ID] = unbonding
	stakeStore.mu.Unlock()

	return unbonding, nil
}

// Claim rewards
func ClaimRewards(delegationID string) (float64, error) {
	stakeStore.mu.RLock()
	delegation, ok := stakeStore.delegations[delegationID]
	if !ok {
		stakeStore.mu.RUnlock()
		return 0, fmt.Errorf("delegation not found")
	}

	validator, vok := stakeStore.validators[delegation.ValidatorID]
	stakeStore.mu.RUnlock()

	if !vok {
		return 0, fmt.Errorf("validator not found")
	}

	rewards := delegation.Rewards

	stakeStore.mu.Lock()
	delegation.Rewards = 0
	stakeStore.mu.Unlock()

	return rewards, nil
}

// Distribute validator rewards
func DistributeRewards(validatorID string, epoch int, reward, bonus float64) error {
	stakeStore.mu.RLock()
	validator, ok := stakeStore.validators[validatorID]
	stakeStore.mu.RUnlock()

	if !ok {
		return fmt.Errorf("validator not found")
	}

	dist := &RewardDist{
		ValidatorID: validatorID,
		Epoch: epoch,
		Reward: reward,
		Bonus: bonus,
		Timestamp: time.Now().UnixMilli(),
	}

	// Award to delegations proportionally
	stakeStore.mu.RLock()
	for _, d := range stakeStore.delegations {
		if d.ValidatorID == validatorID && d.Status == "active" {
			share := d.Amount / validator.Stake
			d.Rewards += (reward + bonus) * share
		}
	}
	stakeStore.mu.RUnlock()

	stakeStore.mu.Lock()
	if _, ok := stakeStore.rewards[validatorID]; !ok {
		stakeStore.rewards[validatorID] = []RewardDist{}
	}
	stakeStore.rewards[validatorID] = append(stakeStore.rewards[validatorID], *dist)
	stakeStore.mu.Unlock()

	return nil
}

// Get validators
func GetValidators(status string) []*Validator {
	stakeStore.mu.RLock()
	defer stakeStore.mu.RUnlock()

	var result []*Validator
	for _, v := range stakeStore.validators {
		if status == "" || v.Status == status {
			result = append(result, v)
		}
	}
	return result
}

func main() {
	fmt.Println("Staking service initialized")

	// Register validator
	validator := RegisterValidator("Titan Validator", "val_address_here", 5.0)
	fmt.Printf("Validator: %s APY: %.1f%%\n", validator.ID, validator.APY*100)

	// Delegate
	del, _ := Delegate("user1", validator.ID, 10000)
	fmt.Printf("Delegated: %s Amount: %.0f\n", del.ID, del.Amount)
}