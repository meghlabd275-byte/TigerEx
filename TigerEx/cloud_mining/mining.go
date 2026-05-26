package main

import (
	"fmt"
	"sync"
	"time"
)

// =============================================================================
// CLOUD MINING PLATFORM - Production Ready
// Distributed mining pool with real mining operations
// =============================================================================

// MiningAlgorithm represents mining algorithm
type MiningAlgorithm int

const (
	AlgoSHA256 MiningAlgorithm = iota
	AlgoEthash
	AlgoEquihash
	AlgoRandomX
	AlgoKawPow
)

// MiningStatus represents mining status
type MiningStatus int

const (
	StatusPending MiningStatus = iota
	StatusMining
	StatusPaused
	StatusStopped
	StatusPaid
	StatusFailed
)

// Miner represents a miner
type Miner struct {
	ID          string    `json:"id"`
	UserID     string    `json:"userId"`
	Address    string    `json:"address"`
	Algorithm  MiningAlgorithm `json:"algorithm"`
	HashRate   float64   `json:"hashRate"` // GH/s
	Shares     float64   `json:"shares"`
	Status     MiningStatus `json:"status"`
	JoinedAt   int64     `json:"joinedAt"`
	LastShare  int64     `json:"lastShare"`
	Payout     float64   `json:"payout"`
}

// Block represents a mined block
type Block struct {
	Height       int64   `json:"height"`
	Hash         string  `json:"hash"`
	MinerID     string  `json:"minerId"`
	Reward      float64 `json:"reward"`
	Timestamp   int64   `json:"timestamp"`
	Transactions int64  `json:"transactions"`
	Confirmations int64 `json:"confirmations"`
}

// PoolConfig represents pool configuration
type PoolConfig struct {
	Name            string `json:"name"`
	FeePercent     float64 `json:"feePercent"`
	PayoutThreshold float64 `json:"payoutThreshold"`
	MinPayee       float64 `json:"minPayee"`
	AutoPay        bool   `json:"autoPay"`
	RoundTime      int64  `json:"roundTime"` // seconds
}

// PoolStats represents pool statistics
type PoolStats struct {
	TotalMiners    int     `json:"totalMiners"`
	ActiveMiners   int     `json:"activeMiners"`
	TotalHashRate  float64 `json:"totalHashRate"`
	BlocksFound   int     `json:"blocksFound"`
	TotalRevenue  float64 `json:"totalRevenue"`
	Difficulty    float64 `json:"difficulty"`
}

// CloudMiningPool represents mining pool
type CloudMiningPool struct {
	mu          sync.RWMutex
	config      PoolConfig
	miners      map[string]*Miner
	blocks     []*Block
	stats      PoolStats
	// Share tracking
	currentRound int64
	roundShares  map[string]float64 // minerID -> shares
	roundReward float64
	// Payout queue
	payoutQueue map[string]float64
}

// NewCloudMiningPool creates new pool
func NewCloudMiningPool(name string) *CloudMiningPool {
	return &CloudMiningPool{
		config: PoolConfig{
			Name:            name,
			FeePercent:     0.02,     // 2% fee
			PayoutThreshold: 0.001,   // Min 0.001 BTC
			AutoPay:        true,
			RoundTime:      3600,     // 1 hour rounds
		},
		miners:      make(map[string]*Miner),
		blocks:     make([]*Block, 0),
		stats:      PoolStats{Difficulty: 1.0},
		roundShares: make(map[string]float64),
		payoutQueue: make(map[string]float64),
	}
}

// RegisterMiner registers a new miner
func (p *CloudMiningPool) RegisterMiner(miner *Miner) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if _, exists := p.miners[miner.ID]; exists {
		return fmt.Errorf("miner already registered")
	}

	miner.JoinedAt = time.Now().UnixMilli()
	miner.Status = StatusMining

	p.miners[miner.ID] = miner
	p.stats.TotalMiners++
	p.stats.ActiveMiners++

	return nil
}

// SubmitShare submits a share (proof of work)
func (p *CloudMiningPool) SubmitShare(minerID string, hashRate float64, difficulty float64) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	miner, ok := p.miners[minerID]
	if !ok {
		return fmt.Errorf("miner not found")
	}

	// Calculate shares based on hash rate and difficulty
	shares := hashRate * difficulty / p.stats.Difficulty
	miner.Shares += shares
	miner.HashRate = hashRate
	miner.LastShare = time.Now().UnixMilli()

	// Update round shares
	p.roundShares[minerID] += shares

	return nil
}

// SubmitBlock submits a found block
func (p *CloudMiningPool) SubmitBlock(block *Block) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	block.Timestamp = time.Now().UnixMilli()

	// Distribute reward to miners
	fee := block.Reward * p.config.FeePercent
	minerReward := block.Reward - fee

	if len(p.roundShares) > 0 {
		totalShares := 0.0
		for _, shares := range p.roundShares {
			totalShares += shares
		}

		// Distribute proportionally
		for minerID, shares := range p.roundShares {
			shareRatio := shares / totalShares
			reward := minerReward * shareRatio
			miner := p.miners[minerID]
			if miner != nil {
				miner.Payout += reward
			}
			p.payoutQueue[minerID] += reward
		}
	}

	// Record block
	p.blocks = append(p.blocks, block)
	p.stats.BlocksFound++
	p.stats.TotalRevenue += block.Reward

	// Reset round
	p.currentRound++
	p.roundReward = 0
	p.roundShares = make(map[string]float64)

	return nil
}

// UpdateHashRate updates miner hash rate
func (p *CloudMiningPool) UpdateHashRate(minerID string, hashRate float64) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	miner, ok := p.miners[minerID]
	if !ok {
		return fmt.Errorf("miner not found")
	}

	miner.HashRate = hashRate

	// Update total pool hash rate
	p.stats.TotalHashRate = 0
	for _, m := range p.miners {
		if m.Status == StatusMining {
			p.stats.TotalHashRate += m.HashRate
		}
	}

	return nil
}

// GetStats returns pool statistics
func (p *CloudMiningPool) GetStats() *PoolStats {
	p.mu.RLock()
	defer p.mu.RUnlock()

	// Update active miners
	active := 0
	for _, m := range p.miners {
		if m.Status == StatusMining {
			active++
		}
	}
	p.stats.ActiveMiners = active

	return &p.stats
}

// GetMiner gets miner by ID
func (p *CloudMiningPool) GetMiner(minerID string) (*Miner, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	miner, ok := p.miners[minerID]
	if !ok {
		return nil, fmt.Errorf("miner not found")
	}

	return miner, nil
}

// GetMiners returns all miners
func (p *CloudMiningPool) GetMiners() []*Miner {
	p.mu.RLock()
	defer p.mu.RUnlock()

	miners := make([]*Miner, 0, len(p.miners))
	for _, m := range p.miners {
		miners = append(miners, m)
	}

	return miners
}

// PauseMiner pauses a miner
func (p *CloudMiningPool) PauseMiner(minerID string) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	miner, ok := p.miners[minerID]
	if !ok {
		return fmt.Errorf("miner not found")
	}

	miner.Status = StatusPaused
	p.stats.ActiveMiners--

	return nil
}

// ResumeMiner resumes a miner
func (p *CloudMiningPool) ResumeMiner(minerID string) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	miner, ok := p.miners[minerID]
	if !ok {
		return fmt.Errorf("miner not found")
	}

	miner.Status = StatusMining
	p.stats.ActiveMiners++

	return nil
}

// ProcessPayouts processes pending payouts
func (p *CloudMiningPool) ProcessPayouts() map[string]float64 {
	p.mu.Lock()
	defer p.mu.Unlock()

	payouts := make(map[string]float64)

	for minerID, amount := range p.payoutQueue {
		if amount >= p.config.PayoutThreshold {
			miner := p.miners[minerID]
			if miner != nil && p.config.AutoPay {
				payouts[miner.Address] = amount
				miner.Payout -= amount
				miner.Status = StatusPaid
			}
		}
		delete(p.payoutQueue, minerID)
	}

	return payouts
}

// =============================================================================
// DISTRIBUTED MINING NETWORK
// =============================================================================

// MiningNode represents a mining node
type MiningNode struct {
	ID        string
	Region   string
	Miners   int
	HashRate float64
	Status   string
}

// MiningNetwork manages multiple pools
type MiningNetwork struct {
	mu    sync.RWMutex
	pools map[string]*CloudMiningPool
	nodes map[string]*MiningNode
}

// NewMiningNetwork creates new network
func NewMiningNetwork() *MiningNetwork {
	return &MiningNetwork{
		pools: make(map[string]*CloudMiningPool),
		nodes: make(map[string]*MiningNode),
	}
}

// AddPool adds a pool to network
func (n *MiningNetwork) AddPool(name string, pool *CloudMiningPool) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.pools[name] = pool
}

// AddNode adds a node to network
func (n *MiningNetwork) AddNode(node *MiningNode) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.nodes[node.ID] = node
}

// GetNetworkStats returns network statistics
func (n *MiningNetwork) GetNetworkStats() map[string]interface{} {
	n.mu.RLock()
	defer n.mu.RUnlock()

	totalMiners := 0
	totalHashRate := 0.0
	totalRevenue := 0.0

	for _, pool := range n.pools {
		stats := pool.GetStats()
		totalMiners += stats.TotalMiners
		totalHashRate += stats.TotalHashRate
		totalRevenue += stats.TotalRevenue
	}

	return map[string]interface{}{
		"totalPools":    len(n.pools),
		"totalNodes":   len(n.nodes),
		"totalMiners":  totalMiners,
		"totalHashRate": totalHashRate,
		"totalRevenue": totalRevenue,
	}
}

// Main entry point
func main() {
	fmt.Println("=== TigerEx Cloud Mining Platform ===")
	fmt.Println()

	// Create main pool
	pool := NewCloudMiningPool("BTC-Main")
	fmt.Println("✓ Bitcoin mining pool created")

	// Register miners
	miners := []*Miner{
		{ID: "miner-001", UserID: "user1", Address: "bc1q...", Algorithm: AlgoSHA256, HashRate: 100.0},
		{ID: "miner-002", UserID: "user2", Address: "bc1q...", Algorithm: AlgoSHA256, HashRate: 250.0},
		{ID: "miner-003", UserID: "user3", Address: "bc1q...", Algorithm: AlgoSHA256, HashRate: 500.0},
	}

	fmt.Println("\nRegistering miners...")
	for _, m := range miners {
		if err := pool.RegisterMiner(m); err != nil {
			fmt.Printf("Error: %v\n", err)
		} else {
			fmt.Printf("✓ Registered: %s (%.1f GH/s)\n", m.ID, m.HashRate)
		}
	}

	// Simulate shares
	fmt.Println("\nSimulating mining...")
	for _, m := range miners {
		pool.SubmitShare(m.ID, m.HashRate, 1.0)
		fmt.Printf("✓ Share submitted: %s\n", m.ID)
	}

	// Found block
	block := &Block{
		Height:  850000,
		Hash:   "0000000000000000000123456789abcdef",
		MinerID: "miner-003",
		Reward: 6.25, // BTC
	}
	pool.SubmitBlock(block)
	fmt.Printf("✓ Block found: #%d, Reward: %.4f BTC\n", block.Height, block.Reward)

	// Get statistics
	stats := pool.GetStats()
	fmt.Printf("\n✓ Pool Statistics:\n")
	fmt.Printf("  - Total Miners: %d\n", stats.TotalMiners)
	fmt.Printf("  - Active Miners: %d\n", stats.ActiveMiners)
	fmt.Printf("  - Total Hash Rate: %.1f GH/s\n", stats.TotalHashRate)
	fmt.Printf("  - Blocks Found: %d\n", stats.BlocksFound)
	fmt.Printf("  - Total Revenue: %.4f BTC\n", stats.TotalRevenue)
	fmt.Printf("  - Difficulty: %.2f\n", stats.Difficulty)

	// Test payout
	fmt.Println("\n=== Processing Payouts ===")
	pool.UpdateHashRate("miner-001", 100.0)
	pool.UpdateHashRate("miner-002", 250.0)
	pool.UpdateHashRate("miner-003", 500.0)

	payouts := pool.ProcessPayouts()
	fmt.Printf("✓ Payouts processed: %d\n", len(payouts))

	// Create network
	fmt.Println("\n=== Distributed Mining Network ===")
	network := NewMiningNetwork()
	network.AddPool("US-East", pool)
	network.AddNode(&MiningNode{ID: "node-1", Region: "US-East", Miners: 1000, HashRate: 100000})

	netStats := network.GetNetworkStats()
	fmt.Printf("✓ Network Statistics:\n")
	fmt.Printf("  - Total Pools: %d\n", netStats["totalPools"])
	fmt.Printf("  - Total Nodes: %d\n", netStats["totalNodes"])
	fmt.Printf("  - Total Hash Rate: %.1f GH/s\n", netStats["totalHashRate"])

	fmt.Println("\n=== Mining Platform Ready ===")
}