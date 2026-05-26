// Package masternode provides masternode services.
// Migrated from TypeScript to Go for masternode staking.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Masternode
type Masternode struct {
	ID              string  `json:"id"`
	Operator       string  `json:"operator"`
	Collateral     float64 `json:"collateral"`
	Status        string  `json:"status"` // active, offline, banned
	Uptime         float64 `json:"uptime"` // %
	BlocksMined    int     `json:"blocksMined"`
	LastPing       int64   `json:"lastPing"`
}

// Reward
type MasternodeReward struct {
	NodeID    string  `json:"nodeId"`
	Operator string  `json:"operator"`
	Reward   float64 `json:"reward"`
	Period   int64   `json:"period"`
}

// Store
type MasternodeStore struct {
	mu         sync.RWMutex
	nodes      map[string]*Masternode
	rewards   map[string][]*MasternodeReward
}

var (
	mnStore = &MasternodeStore{
		nodes: make(map[string]*Masternode),
		rewards: make(map[string][]*MasternodeReward),
	}
)

// Register masternode
func Register(operator string, collateral float64) (*Masternode, error) {
	minCollateral := 10000.0
	if collateral < minCollateral {
		return nil, fmt.Errorf("insufficient collateral: need %.0f", minCollateral)
	}

	node := &Masternode{
		ID: fmt.Sprintf("node_%d", time.Now().UnixNano()),
		Operator: operator,
		Collateral: collateral,
		Status: "active",
		Uptime: 99.9,
		BlocksMined: 0,
		LastPing: time.Now().UnixMilli(),
	}

	mnStore.mu.Lock()
	defer mnStore.mu.Unlock()
	mnStore.nodes[node.ID] = node

	return node, nil
}

// Ping (heartbeat)
func Ping(nodeID string) error {
	mnStore.mu.Lock()
	defer mnStore.mu.Unlock()

	node, ok := mnStore.nodes[nodeID]
	if !ok {
		return fmt.Errorf("node not found")
	}

	node.LastPing = time.Now().UnixMilli()
	return nil
}

// Distribute rewards
func DistributeRewards() map[string]float64 {
	mnStore.mu.Lock()
	defer mnStore.mu.Unlock()

	rewardPool := 1000.0 // Daily pool
	activeCount := 0

	for _, n := range mnStore.nodes {
		if n.Status == "active" {
			activeCount++
		}
	}

	if activeCount == 0 {
		return nil
	}

	rewardPerNode := rewardPool / float64(activeCount)
	distributions := make(map[string]float64)

	for _, n := range mnStore.nodes {
		if n.Status == "active" {
			distributions[n.ID] = rewardPerNode
		}
	}

	return distributions
}

// Get node status
func GetNodeStatus(nodeID string) (*Masternode, bool) {
	mnStore.mu.RLock()
	defer mnStore.mu.RUnlock()

	node, ok := mnStore.nodes[nodeID]
	return node, ok
}

func main() {
	fmt.Println("Masternode service initialized")

	// Register
	node, err := Register("operator_001", 10000)
	if err != nil {
		fmt.Printf("Error: %v\n", err)
	} else {
		fmt.Printf("Registered: %s, collateral %.0f\n", node.ID, node.Collateral)
	}

	// Rewards
	rewards := DistributeRewards()
	fmt.Printf("Distributing to %d nodes\n", len(rewards))
}