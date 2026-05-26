// Package audit_trail provides immutable audit trail services.
// Migrated from TypeScript to Go for compliance audits.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Audit entry
type AuditEntry struct {
	ID          string  `json:"id"`
	Timestamp  int64   `json:"timestamp"`
	Actor      string  `json:"actor"`
	Action     string  `json:"action"`
	Resource   string  `json:"resource"`
	Result     string  `json:"result"` // success, failure
	IPAddress  string  `json:"ipAddress"`
	UserAgent  string  `json:"userAgent"`
	Data      string  `json:"data"` // JSON
}

// Store
type AuditStore struct {
	mu     sync.RWMutex
	entries []AuditEntry
	index  map[string][]int // actor -> entry indices
}

var (
	auditStore = &AuditStore{
		entries: make([]AuditEntry, 0),
		index: make(map[string][]int),
	}
)

// Log action
func LogAction(actor, action, resource, result, ip, userAgent, data string) string {
	entry := AuditEntry{
		ID: fmt.Sprintf("audit_%d", time.Now().UnixNano()),
		Timestamp: time.Now().UnixMilli(),
		Actor: actor,
		Action: action,
		Resource: resource,
		Result: result,
		IPAddress: ip,
		UserAgent: userAgent,
		Data: data,
	}

	auditStore.mu.Lock()
	defer auditStore.mu.Unlock()

	idx := len(auditStore.entries)
	auditStore.entries = append(auditStore.entries, entry)

	// Index by actor
	auditStore.index[actor] = append(auditStore.index[actor], idx)

	return entry.ID
}

// Query logs
func QueryLogs(actor, action, resource string, from, to int64) []AuditEntry {
	auditStore.mu.RLock()
	defer auditStore.mu.RUnlock()

	var result []AuditEntry
	for _, e := range auditStore.entries {
		if (actor == "" || e.Actor == actor) &&
			(action == "" || e.Action == action) &&
			(resource == "" || e.Resource == resource) &&
			e.Timestamp >= from && e.Timestamp <= to {
			result = append(result, e)
		}
	}

	return result
}

// Get actor history
func GetActorHistory(actor string) []AuditEntry {
	auditStore.mu.RLock()
	defer auditStore.mu.RUnlock()

	var result []AuditEntry
	if indices, ok := auditStore.index[actor]; ok {
		for _, idx := range indices {
			result = append(result, auditStore.entries[idx])
		}
	}

	return result
}

// Export for compliance
func Export(start, end int64) string {
	entries := QueryLogs("", "", "", start, end)

	fmt.Printf("Exported %d audit entries\n", len(entries))

	return "compliance_export.json"
}

func main() {
	fmt.Println("Audit Trail service initialized")

	// Log actions
	LogAction("user_001", "login", "auth", "success", "192.168.1.1", "Chrome", "")
	LogAction("user_001", "withdraw", "wallet", "success", "192.168.1.1", "Chrome", "amount=5000")
	LogAction("admin_001", "kyc_approve", "kyc", "success", "10.0.0.1", "Chrome", "user=user_002")

	// Query
	logs := QueryLogs("user_001", "", "", 0, time.Now().UnixMilli())
	fmt.Printf("User logs: %d\n", len(logs))
}