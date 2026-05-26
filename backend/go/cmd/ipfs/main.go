// Package ipfs provides IPFS storage services.
// Migrated from TypeScript to Go for decentralized storage.
package main

import (
	"fmt"
	"sync"
	"time"
)

// IPFS node
type IPFSNode struct {
	ID        string  `json:"id"`
	Address   string  `json:"address"`
	PeerCount int    `json:"peerCount"`
	Status    string  `json:"status"` // online, offline
}

// Stored file
type IPFSFile struct {
	CID       string  `json:"cid"`
	Name     string  `json:"name"`
	Size     int64   `json:"size"`
	CreatedAt int64  `json:"createdAt"`
	Pinned   bool    `json:"pinned"`
}

// Store
type IPFSStore struct {
	mu    sync.RWMutex
	nodes map[string]*IPFSNode
	files map[string]*IPFSFile
}

var (
	ipfsStore = &IPFSStore{
		nodes: make(map[string]*IPFSNode),
		files: make(map[string]*IPFSFile),
	}
)

// Initialize IPFS
func init() {
	nodes := []*IPFSNode{
		{ID: "node1", Address: "/ip4/10.0.1.1/tcp/4001", PeerCount: 100, Status: "online"},
		{ID: "node2", Address: "/ip4/10.0.1.2/tcp/4001", PeerCount: 80, Status: "online"},
	}

	ipfsStore.mu.Lock()
	defer ipfsStore.mu.Unlock()

	for _, n := range nodes {
		ipfsStore.nodes[n.ID] = n
	}
}

// Add file to IPFS
func AddFile(name string, data []byte) *IPFSFile {
	file := &IPFSFile{
		CID: fmt.Sprintf("Qm%s", generateCID()),
		Name: name,
		Size: int64(len(data)),
		CreatedAt: time.Now().UnixMilli(),
		Pinned: true,
	}

	ipfsStore.mu.Lock()
	defer ipfsStore.mu.Unlock()
	ipfsStore.files[file.CID] = file

	return file
}

// Pin file
func PinFile(cid string) error {
	ipfsStore.mu.Lock()
	defer ipfsStore.mu.Unlock()

	if file, ok := ipfsStore.files[cid]; ok {
		file.Pinned = true
		return nil
	}

	return fmt.Errorf("file not found")
}

// Unpin file
func UnpinFile(cid string) error {
	ipfsStore.mu.Lock()
	defer ipfsStore.mu.Unlock()

	if file, ok := ipfsStore.files[cid]; ok {
		file.Pinned = false
		return nil
	}

	return fmt.Errorf("file not found")
}

// Get file
func GetFile(cid string) (*IPFSFile, bool) {
	ipfsStore.mu.RLock()
	defer ipfsStore.mu.RUnlock()

	file, ok := ipfsStore.files[cid]
	return file, ok
}

// List pinned files
func ListPinned() []*IPFSFile {
	ipfsStore.mu.RLock()
	defer ipfsStore.mu.RUnlock()

	var result []*IPFSFile
	for _, f := range ipfsStore.files {
		if f.Pinned {
			result = append(result, f)
		}
	}

	return result
}

// Get peers
func GetPeers() []*IPFSNode {
	ipfsStore.mu.RLock()
	defer ipfsStore.mu.RUnlock()

	var result []*IPFSNode
	for _, n := range ipfsStore.nodes {
		result = append(result, n)
	}

	return result
}

func generateCID() string {
	return fmt.Sprintf("%x", time.Now().UnixNano())[:12]
}

func main() {
	fmt.Println("IPFS Service initialized")

	// Add file
	file := AddFile("document.pdf", []byte("PDF_DATA_HERE"))
	fmt.Printf("Added: %s\n", file.CID)

	// Pin
	PinFile(file.CID)

	// List
	pinned := ListPinned()
	fmt.Printf("Pinned files: %d\n", len(pinned))
}