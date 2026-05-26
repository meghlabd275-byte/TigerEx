// Package block_explorer provides blockchain explorer services.
// Migrated from TypeScript to Go for chain exploration.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Block info
type Block struct {
	Height      int     `json:"height"`
	Hash        string  `json:"hash"`
	ParentHash  string  `json:"parentHash"`
	Timestamp  int64   `json:"timestamp"`
	Transactions int   `json:"transactions"`
	Size       int     `json:"size"`
	GasUsed    uint64  `json:"gasUsed"`
	GasLimit   uint64  `json:"gasLimit"`
	Miner      string  `json:"miner"`
	Reward     float64 `json:"reward"`
}

// Transaction
type ExplorerTx struct {
	Hash       string  `json:"hash"`
	BlockHash string  `json:"blockHash"`
	Block     int     `json:"block"`
	From      string  `json:"from"`
	To        string  `json:"to"`
	Value     float64 `json:"value"`
	Gas       uint64  `json:"gas"`
	GasPrice  uint64  `json:"gasPrice"`
	Timestamp int64   `json:"timestamp"`
	Status    string  `json:"status"` // confirmed, pending
}

// Address info
type AddressInfo struct {
	Address      string  `json:"address"`
	Balance      float64 `json:"balance"`
	TxCount     int     `json:"txCount"`
	FirstSeen   int64   `json:"firstSeen"`
	LastSeen    int64   `json:"lastSeen"`
}

// Token transfer
type TokenTransfer struct {
	TxHash     string  `json:"txHash"`
	From       string  `json:"from"`
	To         string  `json:"to"`
	Token      string  `json:"token"`
	Amount     float64 `json:"amount"`
	Timestamp  int64   `json:"timestamp"`
}

// Store
type ExplorerStore struct {
	mu   sync.RWMutex
	blocks map[int]*Block
	txs    map[string]*ExplorerTx
	addrs  map[string]*AddressInfo
}

var (
	expStore = &ExplorerStore{
		blocks: make(map[int]*Block),
		txs: make(map[string]*ExplorerTx),
		addrs: make(map[string]*AddressInfo),
	}
)

// Get block by height
func GetBlock(height int) (*Block, bool) {
	expStore.mu.RLock()
	defer expStore.mu.RUnlock()

	block, ok := expStore.blocks[height]
	return block, ok
}

// Get block by hash
func GetBlockByHash(hash string) (*Block, bool) {
	expStore.mu.RLock()
	defer expStore.mu.RUnlock()

	for _, b := range expStore.blocks {
		if b.Hash == hash {
			return b, true
		}
	}

	return nil, false
}

// Get transaction
func GetTransaction(hash string) (*ExplorerTx, bool) {
	expStore.mu.RLock()
	defer expStore.mu.RUnlock()

	tx, ok := expStore.txs[hash]
	return tx, ok
}

// Get address info
func GetAddress(addr string) (*AddressInfo, bool) {
	expStore.mu.RLock()
	defer expStore.mu.RUnlock()

	info, ok := expStore.addrs[addr]
	return info, ok
}

// Search
func Search(query string) (string, string) {
	// Check if block height
	// Check if transaction hash
	// Check if address

	if len(query) == 66 { // tx hash
		return "transaction", query
	}

	if len(query) == 42 && query[:2] == "0x" { // address
		return "address", query
	}

	return "unknown", query
}

// Recent blocks
func GetRecentBlocks(limit int) []*Block {
	expStore.mu.RLock()
	defer expStore.mu.RUnlock()

	var blocks []*Block
	height := 1000 // Latest block

	for i := 0; i < limit; i++ {
		if b, ok := expStore.blocks[height-i]; ok {
			blocks = append(blocks, b)
		}
	}

	return blocks
}

// Address transactions
func GetAddressTxs(addr string, limit int) []*ExplorerTx {
	expStore.mu.RLock()
	defer expStore.mu.RUnlock()

	var txs []*ExplorerTx
	count := 0

	for _, tx := range expStore.txs {
		if (tx.From == addr || tx.To == addr) && count < limit {
			txs = append(txs, tx)
			count++
		}
	}

	return txs
}

func main() {
	fmt.Println("Block Explorer service initialized")

	// Sample block
	block := &Block{
		Height: 1000,
		Hash: "0x12345abc",
		Timestamp: time.Now().UnixMilli(),
		Transactions: 150,
	}

	expStore.mu.Lock()
	expStore.blocks[block.Height] = block
	expStore.mu.Unlock()

	// Display
	fmt.Printf("Latest block: %d\n", block.Height)
	
	// Search
	stype, _ := Search("0x12345abc")
	fmt.Printf("Search result: %s\n", stype)
}