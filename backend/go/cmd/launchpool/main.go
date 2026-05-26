// Package launchpool provides token launchpool services.
// Migrated from TypeScript to Go for new token launches.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Launchpool project
type LaunchpoolProject struct {
	ID          string  `json:"id"`
	Name       string  `json:"name"`
	Token      string  `json:"token"`
	TotalRewards float64 `json:"totalRewards"`
	StakingToken string `json:"stakingToken"`
	Duration    int     `json:"duration"` // days
	MinStake   float64 `json:"minStake"`
	StartTime  int64   `json:"startTime"`
	EndTime    int64   `json:"endTime"`
	Status     string  `json:"status"` // upcoming, active, ended
	Participants int   `json:"participants"`
}

// Staking position
type LaunchpoolStake struct {
	ID        string  `json:"id"`
	UserID   string  `json:"userId"`
	ProjectID string `json:"projectId"`
	Amount   float64 `json:"amount"`
	StartTime int64  `json:"startTime"`
	Claimed   bool   `json:"claimed"`
}

// Reward calculation
type LaunchpoolReward struct {
	UserID    string  `json:"userId"`
	ProjectID string  `json:"projectId"`
	StakeAmount float64 `json:"stakeAmount"`
	RewardAmount float64 `json:"rewardAmount"`
	Multiplier float64  `json:"multiplier"`
}

// Store
type LaunchpoolStore struct {
	mu          sync.RWMutex
	projects    map[string]*LaunchpoolProject
	stakes     map[string]*LaunchpoolStake
}

var (
	lpStore = &LaunchpoolStore{
		projects: make(map[string]*LaunchpoolProject),
		stakes:  make(map[string]*LaunchpoolStake),
	}
)

// Create launchpool project
func CreateProject(name, token, stakingToken string, rewards float64, duration int, minStake float64) *LaunchpoolProject {
	project := &LaunchpoolProject{
		ID:           fmt.Sprintf("lp_%d", time.Now().UnixNano()),
		Name:        name,
		Token:       token,
		TotalRewards: rewards,
		StakingToken: stakingToken,
		Duration:    duration,
		MinStake:    minStake,
		StartTime:  time.Now().UnixMilli(),
		EndTime:    time.Now().UnixMilli() + int64(duration*24*3600000),
		Status:     "upcoming",
		Participants: 0,
	}

	lpStore.mu.Lock()
	defer lpStore.mu.Unlock()
	lpStore.projects[project.ID] = project

	return project
}

// Start project
func StartProject(projectID string) error {
	lpStore.mu.Lock()
	defer lpStore.mu.Unlock()

	p, ok := lpStore.projects[projectID]
	if !ok {
		return fmt.Errorf("project not found")
	}

	p.Status = "active"
	return nil
}

// Stake tokens
func Stake(projectID, userID string, amount float64) (*LaunchpoolStake, error) {
	lpStore.mu.Lock()
	defer lpStore.mu.Unlock()

	project, ok := lpStore.projects[projectID]
	if !ok {
		return nil, fmt.Errorf("project not found")
	}

	if project.Status != "active" {
		return nil, fmt.Errorf("project not active")
	}

	if amount < project.MinStake {
		return nil, fmt.Errorf("amount below minimum")
	}

	stake := &LaunchpoolStake{
		ID:        fmt.Sprintf("stake_%d", time.Now().UnixNano()),
		UserID:   userID,
		ProjectID: projectID,
		Amount:   amount,
		StartTime: time.Now().UnixMilli(),
		Claimed:  false,
	}

	project.Participants++
	lpStore.stakes[stake.ID] = stake

	return stake, nil
}

// Calculate rewards
func CalculateRewards(projectID, userID string) (*LaunchpoolReward, error) {
	lpStore.mu.RLock()
	defer lpStore.mu.RUnlock()

	project, ok := lpStore.projects[projectID]
	if !ok {
		return nil, fmt.Errorf("project not found")
	}

	// Find user's stake
	var stake *LaunchpoolStake
	for _, s := range lpStore.stakes {
		if s.ProjectID == projectID && s.UserID == userID && !s.Claimed {
			stake = s
			break
		}
	}

	if stake == nil {
		return nil, fmt.Errorf("no active stake found")
	}

	// Calculate total staked for this project
	var totalStaked float64
	for _, s := range lpStore.stakes {
		if s.ProjectID == projectID && !s.Claimed {
			totalStaked += s.Amount
		}
	}

	if totalStaked == 0 {
		return nil, fmt.Errorf("no total staked")
	}

	// Calculate reward: (user_stake / total_staked) * total_rewards
	rewardAmount := (stake.Amount / totalStaked) * project.TotalRewards
	multiplier := 1.0

	return &LaunchpoolReward{
		UserID:      userID,
		ProjectID:  projectID,
		StakeAmount: stake.Amount,
		RewardAmount: rewardAmount,
		Multiplier: multiplier,
	}, nil
}

// Claim rewards
func Claim(projectID, userID string) (float64, error) {
	lpStore.mu.Lock()
	defer lpStore.mu.Unlock()

	reward, err := CalculateRewards(projectID, userID)
	if err != nil {
		return 0, err
	}

	// Mark as claimed
	for _, s := range lpStore.stakes {
		if s.ProjectID == projectID && s.UserID == userID {
			s.Claimed = true
			break
		}
	}

	return reward.RewardAmount, nil
}

// Get active projects
func GetActiveProjects() []*LaunchpoolProject {
	lpStore.mu.RLock()
	defer lpStore.mu.RUnlock()

	var result []*LaunchpoolProject
	for _, p := range lpStore.projects {
		if p.Status == "active" || p.Status == "upcoming" {
			result = append(result, p)
		}
	}
	return result
}

func main() {
	fmt.Println("Launchpool service initialized")

	// Create project
	project := CreateProject("Tiger Token Launch", "TIGER", "USDT", 1000000, 30, 100)
	fmt.Printf("Created project: %s - %s\n", project.ID, project.Name)

	// Start
	StartProject(project.ID)

	// Demo stake
	stake, err := Stake(project.ID, "user_001", 1000)
	if err != nil {
		fmt.Printf("Stake error: %v\n", err)
	} else {
		fmt.Printf("Staked: %.2f %s\n", stake.Amount, "USDT")
	}
}