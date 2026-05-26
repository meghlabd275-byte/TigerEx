// Package api_docs provides API documentation services.
// Migrated from TypeScript to Go for API documentation.
package main

import (
	"fmt"
	"sync"
)

// API Doc
type APIDoc struct {
	Endpoint string   `json:"endpoint"`
	Method  string    `json:"method"`
	Summary string   `json:"summary"`
	Params  []Param   `json:"params"`
	Request string   `json:"request"`
	Response string  `json:"response"`
}

// Param
type Param struct {
	Name     string  `json:"name"`
	Type    string   `json:"type"`
	Required bool   `json:"required"`
	Default string  `json:"default"`
}

// Store
type DocStore struct {
	mu    sync.RWMutex
	docs   map[string][]APIDoc
}

var (
	docStore = &DocStore{
		docs: make(map[string][]APIDoc),
	}
)

// Register docs
func RegisterDocs(api string, docs []APIDoc) {
	docStore.mu.Lock()
	defer docStore.mu.Unlock()
	docStore.docs[api] = docs
}

// Get docs
func GetDocs(api string) []APIDoc {
	docStore.mu.RLock()
	defer docStore.mu.RUnlock()
	return docStore.docs[api]
}

// List endpoints
func ListEndpoints(api string) []string {
	docs := GetDocs(api)
	var endpoints []string

	for _, d := range docs {
		endpoints = append(endpoints, fmt.Sprintf("%s %s", d.Method, d.Endpoint))
	}

	return endpoints
}

func main() {
	fmt.Println("API Docs service initialized")

	docs := []APIDoc{
		{Endpoint: "/api/v1/market/ticker", Method: "GET", Summary: "Get ticker"},
		{Endpoint: "/api/v1/order", Method: "POST", Summary: "Place order"},
	}

	RegisterDocs("v2", docs)
	fmt.Printf("Registered %d endpoints\n", len(ListEndpoints("v2")))
}