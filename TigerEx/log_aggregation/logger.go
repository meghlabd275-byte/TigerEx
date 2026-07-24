// TigerEx Log Aggregation
// Built with Go for high-load worldwide distributed systems

package main

import (
	"context"
	"fmt"
	"sync"
	"time"
)

type LogEntry struct {
	ID        string
	Level    string
	Message  string
	Source   string
	Service  string
	Metadata map[string]string
	Timestamp time.Time
}

type LogAggregator struct {
	mu        sync.RWMutex
	logs      []LogEntry
	indexes   map[string][]string
	stats     LogStats
}

type LogStats struct {
	TotalLogs   int64
	InfoLogs    int64
	WarnLogs    int64
	ErrorLogs   int64
	DebugLogs   int64
}

func NewLogAggregator() *LogAggregator {
	return &LogAggregator{
		logs: make([]LogEntry, 0),
		indexes: make(map[string][]string),
	}
}

func (la *LogAggregator) Log(level, source, service, message string, metadata map[string]string) {
	la.mu.Lock()
	defer la.mu.Unlock()
	
	entry := LogEntry{
		ID: generateLogID(),
		Level: level,
		Message: message,
		Source: source,
		Service: service,
		Metadata: metadata,
		Timestamp: time.Now(),
	}
	
	la.logs = append(la.logs, entry)
	la.stats.TotalLogs++
	
	switch level {
	case "INFO":
		la.stats.InfoLogs++
	case "WARN":
		la.stats.WarnLogs++
	case "ERROR":
		la.stats.ErrorLogs++
	case "DEBUG":
		la.stats.DebugLogs++
	}
	
	// Index by service
	la.indexes[service] = append(la.indexes[service], entry.ID)
	
	// Keep last 10000
	if len(la.logs) > 10000 {
		la.logs = la.logs[-10000:]
	}
}

func (la *LogAggregator) Query(service, level string, since time.Time) []LogEntry {
	la.mu.RLock()
	defer la.mu.RUnlock()
	
	var result []LogEntry
	for _, log := range la.logs {
		if service != "" && log.Service != service {
			continue
		}
		if level != "" && log.Level != level {
			continue
		}
		if log.Timestamp.After(since) {
			result = append(result, log)
		}
	}
	
	return result
}

func (la *LogAggregator) GetStats() LogStats {
	la.mu.RLock()
	defer la.mu.RUnlock()
	return la.stats
}

func generateLogID() string {
	return fmt.Sprintf("LOG_%d", time.Now().UnixNano())
}

func main() {
	fmt.Println("TigerEx Log Aggregation")
	fmt.Println("====================")
	
	agg := NewLogAggregator()
	
	// Log messages
	agg.Log("INFO", "api", "orders", "Order created", map[string]string{"order_id": "123"})
	agg.Log("INFO", "api", "orders", "Order filled", map[string]string{"order_id": "123"})
	agg.Log("WARN", "wallet", "balance", "Low balance", map[string]string{"balance": "100"})
	agg.Log("ERROR", "matching", "orderbook", "Orderbook overflow", nil)
	agg.Log("DEBUG", "api", "request", "Request received", map[string]string{"path": "/api/v1"})
	
	// Query
	logs := agg.Query("orders", "INFO", time.Now().Add(-time.Hour))
	fmt.Printf("\nQuery results: %d\n", len(logs))
	
	// Stats
	stats := agg.GetStats()
	fmt.Printf("\nStats:\n")
	fmt.Printf("  Total: %d\n", stats.TotalLogs)
	fmt.Printf("  Info: %d\n", stats.InfoLogs)
	fmt.Printf("  Error: %d\n", stats.ErrorLogs)
}
