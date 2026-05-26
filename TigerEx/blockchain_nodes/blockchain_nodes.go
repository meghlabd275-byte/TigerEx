package main

import (
	"fmt"
	"time"
)

// Chain type
type ChainType string

const (
	ChainEthereum ChainType = "ethereum"
	ChainPolygon ChainType = "polygon"
	ChainBSC ChainType = "bsc"
	ChainSolana ChainType = "solana"
	ChainArbitrum ChainType = "arbitrum"
	ChainOptimism ChainType = "optimism"
	ChainAvalanche ChainType = "avalanche"
)

// Node status
type NodeStatus string

const (
	NodeOnline NodeStatus = "online"
	NodeSyncing NodeStatus = "syncing"
	NodeOffline NodeStatus = "offline"
)

// Blockchain node
type BlockchainNode struct {
	ID         string      `json:"id"`
	Chain      ChainType    `json:"chain"`
	URL        string     `json:"url"`
	Status     NodeStatus  `json:"status"`
	BlockHeight int64      `json:"blockHeight"`
	LastSync   int64       `json:"lastSync"`
}

// Blockchain node manager
type NodeManager struct {
	Nodes map[string]*BlockchainNode
}

// New creates manager
func NewNodeManager() *NodeManager {
	return &NodeManager{
		Nodes: make(map[string]*BlockchainNode),
	}
}

// Add node
func (m *NodeManager) AddNode(chain ChainType, url string) *BlockchainNode {
	id := fmt.Sprintf("node_%s_%d", chain, time.Now().Unix())
	node := &BlockchainNode{
		ID: id,
		Chain: chain,
		URL: url,
		Status: NodeOnline,
		BlockHeight: 0,
		LastSync: time.Now().UnixMilli(),
	}
	m.Nodes[id] = node
	return node
}

// Update block height
func (m *NodeManager) UpdateBlockHeight(nodeID string, height int64) bool {
	node, ok := m.Nodes[nodeID]
	if !ok {
		return false
	}
	
	node.BlockHeight = height
	node.LastSync = time.Now().UnixMilli()
	return true
}

// Get latest block
func (m *NodeManager) GetLatestBlock(chain ChainType) int64 {
	for _, node := range m.Nodes {
		if node.Chain == chain && node.Status == NodeOnline {
			return node.BlockHeight
		}
	}
	return 0
}

// Health check
func (m *NodeManager) HealthCheck(nodeID string) NodeStatus {
	node, ok := m.Nodes[nodeID]
	if !ok {
		return NodeOffline
	}
	
	// Check if syncing
	if time.Now().UnixMilli()-node.LastSync > 60000 {
		return NodeSyncing
	}
	
	return NodeOnline
}

func main() {
	mgr := NewNodeManager()
	
	// Add nodes
	ethNode := mgr.AddNode(ChainEthereum, "https://eth.example.com")
	fmt.Printf("Added: %s\n", ethNode.ID)
	
	// Update height
	mgr.UpdateBlockHeight(ethNode.ID, 15000000)
	height := mgr.GetLatestBlock(ChainEthereum)
	fmt.Printf("ETH block: %d\n", height)
	
	// Health
	status := mgr.HealthCheck(ethNode.ID)
	fmt.Printf("Status: %s\n", status)
}