package main

import (
	"fmt"
	"sync"
	"time"
)

// ============================================================================
// FREEZE HANDLER - Go Implementation
// Account freeze/unfreeze for TigerEx
// ============================================================================

const (
	StatusFrozen = "frozen"
	StatusActive = "active"
)

// FreezeRecord represents a freeze record
type FreezeRecord struct {
	UserID    string    `json:"userId"`
	Status   string    `json:"status"`
	Reason   string    `json:"reason,omitempty"`
	FreezedAt time.Time `json:"createdAt"`
	FrozenBy string    `json:"frozenBy,omitempty"`
}

// FreezeHandler manages account freezes
type FreezeHandler struct {
	mu       sync.RWMutex
	accounts map[string]*FreezeRecord
}

// NewFreezeHandler creates a new freeze handler
func NewFreezeHandler() *FreezeHandler {
	return &FreezeHandler{
		accounts: make(map[string]*FreezeRecord),
	}
}

// Freeze freezes an account
func (fh *FreezeHandler) Freeze(userID, reason, frozenBy string) {
	fh.mu.Lock()
	defer fh.mu.Unlock()

	fh.accounts[userID] = &FreezeRecord{
		UserID:    userID,
		Status:   StatusFrozen,
		Reason:   reason,
		FreezedAt: time.Now(),
		FrozenBy: frozenBy,
	}
}

// Unfreeze unfreezes an account
func (fh *FreezeHandler) Unfreeze(userID string) {
	fh.mu.Lock()
	defer fh.mu.Unlock()

	if record, ok := fh.accounts[userID]; ok {
		record.Status = StatusActive
	}
}

// IsFrozen checks if account is frozen
func (fh *FreezeHandler) IsFrozen(userID string) bool {
	fh.mu.RLock()
	defer fh.mu.RUnlock()

	if record, ok := fh.accounts[userID]; ok {
		return record.Status == StatusFrozen
	}
	return false
}

// GetStatus returns account status
func (fh *FreezeHandler) GetStatus(userID string) string {
	fh.mu.RLock()
	defer fh.mu.RUnlock()

	if record, ok := fh.accounts[userID]; ok {
		return record.Status
	}
	return StatusActive
}

// GetRecord returns freeze record
func (fh *FreezeHandler) GetRecord(userID string) *FreezeRecord {
	fh.mu.RLock()
	defer fh.mu.RUnlock()

	if record, ok := fh.accounts[userID]; ok {
		return record
	}
	return nil
}

// ListFrozen lists all frozen accounts
func (fh *FreezeHandler) ListFrozen() []*FreezeRecord {
	fh.mu.RLock()
	defer fh.mu.RUnlock()

	var frozen []*FreezeRecord
	for _, record := range fh.accounts {
		if record.Status == StatusFrozen {
			frozen = append(frozen, record)
		}
	}
	return frozen
}

// Count returns total frozen count
func (fh *FreezeHandler) Count() int {
	fh.mu.RLock()
	defer fh.mu.RUnlock()
	return len(fh.accounts)
}

// ============================================================================
// EXAMPLE USAGE
// ============================================================================

func main() {
	fh := NewFreezeHandler()

	// Freeze accounts
	fh.Freeze("user1", "Suspicious activity", "admin")
	fh.Freeze("user2", "KYC violation", "compliance")

	// Check status
	fmt.Printf("user1 frozen: %v\n", fh.IsFrozen("user1"))
	fmt.Printf("user2 frozen: %v\n", fh.IsFrozen("user2"))
	fmt.Printf("user3 frozen: %v\n", fh.IsFrozen("user3"))

	// Get record
	record := fh.GetRecord("user1")
	fmt.Printf("user1 record: %+v\n", record)

	// Unfreeze
	fh.Unfreeze("user1")
	fmt.Printf("user1 after unfreeze: %v\n", fh.IsFrozen("user1"))

	// List frozen
	frozen := fh.ListFrozen()
	fmt.Printf("Frozen accounts: %d\n", len(frozen))

	// Get status
	fmt.Printf("user1 status: %s\n", fh.GetStatus("user1"))
}