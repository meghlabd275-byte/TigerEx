// Package index_service provides search indexing services.
// Migrated from TypeScript to Go for search functionality.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Indexed document
type Document struct {
	ID        string  `json:"id"`
	Type     string  `json:"type"` // user, order, transaction
	Fields   map[string]string `json:"fields"`
	Score    float64 `json:"score"`
	IndexedAt int64   `json:"indexedAt"`
}

// Search result
type SearchResult struct {
	ID      string  `json:"id"`
	Score  float64 `json:"score"`
	Highlight string `json:"highlight"`
}

// Index mapping
type Mapping struct {
	Type   string  `json:"type"`
	Fields map[string]string `json:"fields"` // field -> type
}

// Store
type IndexStore struct {
	mu        sync.RWMutex
	indices  map[string]map[string]*Document
	mappings map[string]*Mapping
}

var (
	indexStore = &IndexStore{
		indices: make(map[string]map[string]*Document),
		mappings: make(map[string]*Mapping),
	}
)

// Initialize mappings
func init() {
	mappings := []*Mapping{
		{Type: "user", Fields: map[string]string{"username": "text", "email": "keyword", "created_at": "date"}},
		{Type: "order", Fields: map[string]string{"symbol": "keyword", "side": "keyword", "price": "number"}},
		{Type: "transaction", Fields: map[string]string{"tx_hash": "keyword", "from": "keyword", "to": "keyword"}},
		{Type: "token", Fields: map[string]string{"symbol": "keyword", "name": "text", "chain": "keyword"}},
	}

	indexStore.mu.Lock()
	defer indexStore.mu.Unlock()

	for _, m := range mappings {
		indexStore.mappings[m.Type] = m
		indexStore.indices[m.Type] = make(map[string]*Document)
	}
}

// Index document
func Index(docType, docID string, fields map[string]string) {
	doc := &Document{
		ID: docID,
		Type: docType,
		Fields: fields,
		Score: 1.0,
		IndexedAt: time.Now().UnixMilli(),
	}

	indexStore.mu.Lock()
	defer indexStore.mu.Unlock()

	if idx, ok := indexStore.indices[docType]; ok {
		idx[docID] = doc
	}
}

// Search
func Search(query, docType string, limit int) []*SearchResult {
	indexStore.mu.RLock()
	idx, ok := indexStore.indices[docType]
	indexStore.mu.RUnlock()

	if !ok {
		return nil
	}

	var results []*SearchResult

	for _, doc := range idx {
		// Simple match (in real impl: full-text search)
		for _, v := range doc.Fields {
			if contains(v, query) {
				results = append(results, &SearchResult{
					ID: doc.ID,
					Score: doc.Score,
				})
				break
			}
		}

		if len(results) >= limit {
			break
		}
	}

	return results
}

// Get document
func Get(docType, docID string) (*Document, bool) {
	indexStore.mu.RLock()
	defer indexStore.mu.RUnlock()

	if idx, ok := indexStore.indices[docType]; ok {
		doc, ok := idx[docID]
		return doc, ok
	}

	return nil, false
}

// Delete document
func Delete(docType, docID string) bool {
	indexStore.mu.Lock()
	defer indexStore.mu.Unlock()

	if idx, ok := indexStore.indices[docType]; ok {
		delete(idx, docID)
		return true
	}

	return false
}

// Bulk index
func BulkIndex(docs map[string][][2]string) {
	for docType, docsList := range docs {
		for _, d := range docsList {
			fields := map[string]string{d[0]: d[1]}
			Index(docType, d[0], fields)
		}
	}
}

	fmt.Printf("Bulk indexed\n")
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && 
		(s == substr || 
		 len(s) > 0 && 
		 (s[:len(substr)] == substr || 
		  contains(s[1:], substr))
}

func main() {
	fmt.Println("Index Service initialized")

	// Index samples
	Index("user", "user_001", map[string]string{"username": "john", "email": "john@example.com"})
	Index("order", "ord_001", map[string]string{"symbol": "BTCUSDT", "side": "buy", "price": "65000"})

	// Search
	results := Search("BTC", "order", 10)
	fmt.Printf("Search results: %d\n", len(results))
}