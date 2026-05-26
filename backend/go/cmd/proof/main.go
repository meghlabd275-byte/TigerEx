// Package proof provides proof of reserves verification.
// Migrated from TypeScript to Go for audit verification.
package main

import (
	"encoding/hex"
	"fmt"
	"sync"
)

// Merkle node
type MerkleNode struct {
	Hash   string
	Left  *MerkleNode
	Right *MerkleNode
}

// ReserveProof
type ReserveProof struct {
	RootHash     string    `json:"rootHash"`
	TotalAssets float64  `json:"totalAssets"`
	TotalLiabilities float64 `json:"totalLiabilities"`
	Timestamp  int64    `json:"timestamp"`
	SatoshiKey string   `json:"satoshiKey"`
	Signature string   `json:"signature"`
}

// Account snapshot
type AccountSnapshot struct {
	UserID      string  `json:"userId"`
	WalletAddr string  `json:"walletAddr"`
	Balance    float64 `json:"balance"`
	Hash      string  `json:"hash"`
}

// Auditor
type Auditor struct {
	Name      string  `json:"name"`
	PublicKey string  `json:"publicKey"`
}

// Store
type ProofStore struct {
	mu          sync.RWMutex
	merkleTree   *MerkleNode
	snapshots   []AccountSnapshot
	reserves    []ReserveProof
	auditors   []Auditor
}

var (
	pStore = &ProofStore{
		merkleTree: nil,
		snapshots: make([]AccountSnapshot, 0),
		reserves: make([]ReserveProof, 0),
		auditors: make([]Auditor, 0),
	}
)

// SHA256 hash (simplified)
func hashSHA256(data string) string {
	// In real implementation, use crypto/sha256
	return "sha256_" + hex.EncodeToString([]byte(data))[:32]
}

// Build merkle tree from snapshots
func BuildMerkleTree(snapshots []AccountSnapshot) *MerkleNode {
	if len(snapshots) == 0 {
		return nil
	}

	// Create leaf nodes
	nodes := make([]*MerkleNode, len(snapshots))
	for i, s := range snapshots {
		nodes[i] = &MerkleNode{Hash: s.Hash}
	}

	// Build tree bottom-up
	for len(nodes) > 1 {
		var newLevel []*MerkleNode
		
		for i := 0; i < len(nodes); i += 2 {
			if i+1 < len(nodes) {
				combined := nodes[i].Hash + nodes[i+1].Hash
				parent := &MerkleNode{
					Hash: hashSHA256(combined),
					Left: nodes[i],
					Right: nodes[i+1],
				}
				newLevel = append(newLevel, parent)
			} else {
				newLevel = append(newLevel, nodes[i])
			}
		}
		nodes = newLevel
	}

	return nodes[0]
}

// Generate proof of reserves
func GenerateProof(totalAssets, liabilities float64, auditorKey string) *ReserveProof {
	pStore.mu.Lock()
	defer pStore.mu.Unlock()

	proof := &ReserveProof{
		RootHash: "",
		TotalAssets: totalAssets,
		TotalLiabilities: liabilities,
		Timestamp: 0, // Would use actual time
		SatoshiKey: auditorKey,
		Signature: "", // Would be cryptographic signature
	}

	if pStore.merkleTree != nil {
		proof.RootHash = pStore.merkleTree.Hash
	}

	pStore.reserves = append(pStore.reserves, proof)

	return proof
}

// Verify reserves (check net positive)
func VerifyReserves(proof *ReserveProof) bool {
	net := proof.TotalAssets - proof.TotalLiabilities
	verified := net >= 0 && len(proof.RootHash) > 0 && len(proof.Signature) > 0
	
	return verified
}

// Add auditor
func AddAuditor(name, pubKey string) {
	auditor := Auditor{Name: name, PublicKey: pubKey}
	pStore.mu.Lock()
	defer pStore.mu.Unlock()
	pStore.auditors = append(pStore.auditors, auditor)
}

// Get last audit
func GetLastAudit() *ReserveProof {
	pStore.mu.RLock()
	defer pStore.mu.RUnlock()

	if len(pStore.reserves) == 0 {
		return nil
	}

	return pStore.reserves[len(pStore.reserves)-1]
}

// Calculate merkle proof for account
func CalculateMerkleProof(userID string) ([]string, bool) {
	pStore.mu.RLock()
	defer pStore.mu.RUnlock()

	var path []string
	for _, s := range pStore.snapshots {
		if s.UserID == userID {
			// Simplified: would return actual path in real impl
			path = append(path, s.Hash)
			return path, true
		}
	}

	return path, false
}

func main() {
	fmt.Println("Proof of Reserves initialized")

	// Create snapshots
	snapshots := []AccountSnapshot{
		{UserID: "user1", WalletAddr: "0xABC1", Balance: 1000, Hash: "hash1"},
		{UserID: "user2", WalletAddr: "0xABC2", Balance: 2000, Hash: "hash2"},
		{UserID: "user3", WalletAddr: "0xABC3", Balance: 3000, Hash: "hash3"},
	}

	// Build tree
	pStore.merkleTree = BuildMerkleTree(snapshots)
	fmt.Printf("Merkle Root: %s\n", pStore.merkleTree.Hash)

	// Add auditor
	AddAuditor("Armani", "pubkey_123")

	// Generate proof
	proof := GenerateProof(100000, 50000, "pubkey_123")
	fmt.Printf("Proof: Assets $%.2f, Liabilities $%.2f\n", 
		proof.TotalAssets, proof.TotalLiabilities)

	// Verify
	valid := VerifyReserves(proof)
	fmt.Printf("Verified: %v\n", valid)
}