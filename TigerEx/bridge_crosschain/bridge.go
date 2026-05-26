package main

import (
	"fmt"
	"time"
)

// Chain represents supported blockchains
type Chain string

const (
	ChainBitcoin   Chain = "bitcoin"
	ChainEthereum Chain = "ethereum"
	ChainBSC      Chain = "bsc"
	ChainPolygon  Chain = "polygon"
	ChainAvalanche Chain = "avalanche"
	ChainArbitrum Chain = "arbitrum"
	ChainOptimism Chain = "optimism"
	ChainSolana   Chain = "solana"
)

// Bridge status
type BridgeStatus string

const (
	StatusPending   BridgeStatus = "pending"
	StatusProcessing BridgeStatus = "processing"
	StatusCompleted BridgeStatus = "completed"
	StatusFailed   BridgeStatus = "failed"
)

// Bridge request
type BridgeRequest struct {
	ID             string       `json:"id"`
	UserID         string       `json:"userId"`
	FromChain     Chain        `json:"fromChain"`
	ToChain       Chain        `json:"toChain"`
	Asset         string       `json:"asset"`
	Amount        float64      `json:"amount"`
	DepositAddr   string       `json:"depositAddress"`
	WithdrawAddr string       `json:"withdrawAddress"`
	Status        BridgeStatus `json:"status"`
	Fee           float64     `json:"fee"`
	ReceivedAmt   float64     `json:"receivedAmount"`
	Timestamp     int64       `json:"timestamp"`
}

// Bridge platform
type BridgePlatform struct {
	Requests map[string]*BridgeRequest
	Chains   map[Chain]bool
	Fees     map[Chain]float64
}

// New creates bridge platform
func NewBridgePlatform() *BridgePlatform {
	fees := map[Chain]float64{
		ChainBitcoin: 0.0005,
		ChainEthereum: 0.003,
		ChainBSC: 0.001,
		ChainPolygon: 0.001,
		ChainAvalanche: 0.002,
	}

	return &BridgePlatform{
		Requests: make(map[string]*BridgeRequest),
		Chains: map[Chain]bool{
			ChainBitcoin: true,
			ChainEthereum: true,
			ChainBSC: true,
			ChainPolygon: true,
			ChainAvalanche: true,
		},
		Fees: fees,
	}
}

// Initiate bridge
func (b *BridgePlatform) Initiate(userID, asset string, amount float64, fromChain, toChain Chain) (*BridgeRequest, error) {
	if !b.Chains[fromChain] || !b.Chains[toChain] {
		return nil, fmt.Errorf("unsupported chain")
	}

	fee := b.Fees[fromChain]
	received := amount * (1 - fee)

	req := &BridgeRequest{
		ID: fmt.Sprintf("bridge_%d", time.Now().UnixNano()),
		UserID: userID,
		FromChain: fromChain,
		ToChain: toChain,
		Asset: asset,
		Amount: amount,
		Status: StatusPending,
		Fee: fee,
		ReceivedAmt: received,
		Timestamp: time.Now().UnixMilli(),
	}

	b.Requests[req.ID] = req
	return req, nil
}

// Process bridge
func (b *BridgePlatform) Process(id string) bool {
	req := b.Requests[id]
	if req == nil || req.Status != StatusPending {
		return false
	}

	req.Status = StatusProcessing
	return true
}

// Complete bridge
func (b *BridgePlatform) Complete(id string) bool {
	req := b.Requests[id]
	if req == nil || req.Status != StatusProcessing {
		return false
	}

	req.Status = StatusCompleted
	return true
}

func main() {
	bridge := NewBridgePlatform()

	req, err := bridge.Initiate("user1", "BTC", 1.0, ChainEthereum, ChainBitcoin)
	if err != nil {
		fmt.Printf("Error: %v\n", err)
		return
	}

	fmt.Printf("Bridge: %s - %s %.4f -> %s\n", req.ID, req.Asset, req.Amount, req.ToChain)

	bridge.Process(req.ID)
	bridge.Complete(req.ID)
	fmt.Printf("Status: %s\n", req.Status)
}