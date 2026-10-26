// TigerEx Cross-Chain Bridge Service
//
// The bridge moves value between chains, so a request must never be reported as
// completed unless a chain client actually submitted and confirmed a
// transaction. The previous version set TargetHash from the local clock and
// flipped the status to COMPLETED without touching any chain, which would have
// credited a user for a transfer that never happened.

package crosschainbridge

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"sync"
	"time"
)

// Chain describes a chain the bridge can move value on.
type Chain struct {
	ID       string
	Name     string
	Type     string // EVM, SOLANA, TON
	Decimals int
}

// BridgeStatus is the lifecycle of a bridge request.
type BridgeStatus string

const (
	StatusPending    BridgeStatus = "PENDING"
	StatusProcessing BridgeStatus = "PROCESSING"
	StatusCompleted  BridgeStatus = "COMPLETED"
	StatusFailed     BridgeStatus = "FAILED"
)

// BridgeRequest is one cross-chain transfer.
type BridgeRequest struct {
	ID          string
	UserID      string
	FromChain   string
	ToChain     string
	Token       string
	Amount      float64
	Status      BridgeStatus
	SourceHash  string
	TargetHash  string
	Error       string
	Timestamp   time.Time
	CompletedAt time.Time
}

// ChainClient submits and confirms a transfer on one chain. A real deployment
// wires one implementation per chain (an EVM JSON-RPC client, a Solana RPC
// client, and so on). It is an interface so the bridge never pretends a
// transfer happened.
type ChainClient interface {
	// Submit broadcasts the transfer and returns the source transaction hash.
	Submit(req *BridgeRequest) (string, error)
	// Confirm waits for the destination transaction to be final and returns
	// its hash. It must not return a hash that does not exist on chain.
	Confirm(req *BridgeRequest, sourceHash string) (string, error)
}

// BridgeService coordinates cross-chain transfers.
type BridgeService struct {
	mu       sync.RWMutex
	chains   map[string]*Chain
	requests map[string]*BridgeRequest
	clients  map[string]ChainClient
}

// NewBridgeService creates a bridge with the supported chains registered.
func NewBridgeService() *BridgeService {
	svc := &BridgeService{
		chains:   make(map[string]*Chain),
		requests: make(map[string]*BridgeRequest),
		clients:  make(map[string]ChainClient),
	}
	svc.initChains()
	return svc
}

func (s *BridgeService) initChains() {
	chains := []*Chain{
		{ID: "ETH", Name: "Ethereum", Type: "EVM", Decimals: 18},
		{ID: "BSC", Name: "BNB Smart Chain", Type: "EVM", Decimals: 18},
		{ID: "POL", Name: "Polygon", Type: "EVM", Decimals: 18},
		{ID: "ARB", Name: "Arbitrum", Type: "EVM", Decimals: 18},
		{ID: "OP", Name: "Optimism", Type: "EVM", Decimals: 18},
		{ID: "AVAX", Name: "Avalanche", Type: "EVM", Decimals: 18},
		{ID: "SOL", Name: "Solana", Type: "SOLANA", Decimals: 9},
		{ID: "TON", Name: "Toncoin", Type: "TON", Decimals: 9},
	}
	for _, c := range chains {
		s.chains[c.ID] = c
	}
}

// RegisterClient attaches a chain client for a chain id.
func (s *BridgeService) RegisterClient(chainID string, client ChainClient) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.clients[chainID] = client
}

// CreateRequest validates and records a new bridge request.
//
// The amount must be positive and the source and destination chains must exist
// and differ. The previous version accepted any amount, including negative, and
// any chain id.
func (s *BridgeService) CreateRequest(userID, fromChain, toChain, token string, amount float64) (*BridgeRequest, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if strings.TrimSpace(userID) == "" {
		return nil, fmt.Errorf("user id is required")
	}
	if !(amount > 0) {
		return nil, fmt.Errorf("amount must be positive, got %v", amount)
	}
	if _, ok := s.chains[fromChain]; !ok {
		return nil, fmt.Errorf("unknown source chain: %s", fromChain)
	}
	if _, ok := s.chains[toChain]; !ok {
		return nil, fmt.Errorf("unknown destination chain: %s", toChain)
	}
	if fromChain == toChain {
		return nil, fmt.Errorf("source and destination chains are the same: %s", fromChain)
	}
	if strings.TrimSpace(token) == "" {
		return nil, fmt.Errorf("token is required")
	}

	req := &BridgeRequest{
		ID:        "BRIDGE_" + randomHex(12),
		UserID:    userID,
		FromChain: fromChain,
		ToChain:   toChain,
		Token:     token,
		Amount:    amount,
		Status:    StatusPending,
		Timestamp: time.Now(),
	}
	s.requests[req.ID] = req

	return req, nil
}

// ProcessRequest drives a pending request to completion through the chain
// clients. It returns an error rather than a bool so the caller learns why a
// transfer failed.
func (s *BridgeService) ProcessRequest(requestID string) error {
	s.mu.Lock()
	req, ok := s.requests[requestID]
	if !ok {
		s.mu.Unlock()
		return fmt.Errorf("bridge request not found: %s", requestID)
	}
	if req.Status != StatusPending {
		status := req.Status
		s.mu.Unlock()
		return fmt.Errorf("bridge request %s is not pending (status %s)", requestID, status)
	}
	req.Status = StatusProcessing

	sourceClient, ok := s.clients[req.FromChain]
	if !ok {
		req.Status = StatusFailed
		req.Error = "no client registered for source chain " + req.FromChain
		err := fmt.Errorf("%s", req.Error)
		s.mu.Unlock()
		return err
	}
	targetClient, ok := s.clients[req.ToChain]
	if !ok {
		req.Status = StatusFailed
		req.Error = "no client registered for destination chain " + req.ToChain
		err := fmt.Errorf("%s", req.Error)
		s.mu.Unlock()
		return err
	}
	s.mu.Unlock()

	sourceHash, err := sourceClient.Submit(req)
	if err != nil {
		s.fail(requestID, fmt.Errorf("source submission failed: %w", err))
		return err
	}
	if sourceHash == "" {
		s.fail(requestID, fmt.Errorf("source client returned an empty transaction hash"))
		return fmt.Errorf("source client returned an empty transaction hash")
	}

	targetHash, err := targetClient.Confirm(req, sourceHash)
	if err != nil {
		s.fail(requestID, fmt.Errorf("destination confirmation failed: %w", err))
		return err
	}
	if targetHash == "" {
		s.fail(requestID, fmt.Errorf("destination client returned an empty transaction hash"))
		return fmt.Errorf("destination client returned an empty transaction hash")
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	req = s.requests[requestID]
	req.SourceHash = sourceHash
	req.TargetHash = targetHash
	req.Status = StatusCompleted
	req.CompletedAt = time.Now()

	return nil
}

func (s *BridgeService) fail(requestID string, cause error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if req, ok := s.requests[requestID]; ok {
		req.Status = StatusFailed
		req.Error = cause.Error()
	}
}

// GetChains lists the supported chains in a stable order.
func (s *BridgeService) GetChains() []*Chain {
	s.mu.RLock()
	defer s.mu.RUnlock()

	ids := make([]string, 0, len(s.chains))
	for id := range s.chains {
		ids = append(ids, id)
	}
	sortStrings(ids)

	result := make([]*Chain, 0, len(ids))
	for _, id := range ids {
		result = append(result, s.chains[id])
	}

	return result
}

// GetRequest returns a request by id.
func (s *BridgeService) GetRequest(requestID string) *BridgeRequest {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.requests[requestID]
}

// GetUserRequests returns every request belonging to a user, newest first.
func (s *BridgeService) GetUserRequests(userID string) []*BridgeRequest {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*BridgeRequest
	for _, r := range s.requests {
		if r.UserID == userID {
			result = append(result, r)
		}
	}

	sortByTimestampDesc(result)

	return result
}

// randomHex returns n bytes of secure randomness, hex encoded. Bridge ids and
// hashes must not be derivable from the clock.
func randomHex(n int) string {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		panic(fmt.Sprintf("secure random unavailable: %v", err))
	}
	return hex.EncodeToString(buf)
}

// sortStrings sorts in place (insertion sort keeps this dependency free).
func sortStrings(items []string) {
	for i := 1; i < len(items); i++ {
		key := items[i]
		j := i - 1
		for j >= 0 && items[j] > key {
			items[j+1] = items[j]
			j--
		}
		items[j+1] = key
	}
}

// sortByTimestampDesc orders requests newest first.
func sortByTimestampDesc(items []*BridgeRequest) {
	for i := 1; i < len(items); i++ {
		key := items[i]
		j := i - 1
		for j >= 0 && items[j].Timestamp.Before(key.Timestamp) {
			items[j+1] = items[j]
			j--
		}
		items[j+1] = key
	}
}
