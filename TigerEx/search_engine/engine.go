package main

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
)

// ============================================================================
// SEARCH ENGINE - Go Implementation
// High-performance search for TigerEx
// ============================================================================

// Document represents a searchable document
type Document struct {
	ID      string
	Content string
	Fields map[string]string
}

// SearchResult represents a search result
type SearchResult struct {
	DocumentID string  `json:"documentId"`
	Content    string  `json:"content"`
	Score     float64 `json:"score"`
}

// SearchEngine provides search functionality
type SearchEngine struct {
	index     map[string][]string
	documents map[string]*Document
}

// NewSearchEngine creates a new search engine
func NewSearchEngine() *SearchEngine {
	return &SearchEngine{
		index:     make(map[string][]string),
		documents: make(map[string]*Document),
	}
}

// IndexDocument indexes a document
func (se *SearchEngine) IndexDocument(doc *Document) {
	se.documents[doc.ID] = doc

	// Tokenize content
	terms := tokenize(doc.Content)
	for _, term := range terms {
		// Add to index if not already there
		found := false
		for _, id := range se.index[term] {
			if id == doc.ID {
				found = true
				break
			}
		}
		if !found {
			se.index[term] = append(se.index[term], doc.ID)
		}
	}

	// Also index fields
	for _, value := range doc.Fields {
		fieldTerms := tokenize(value)
		for _, term := range fieldTerms {
			found := false
			for _, id := range se.index[term] {
				if id == doc.ID {
					found = true
					break
				}
			}
			if !found {
				se.index[term] = append(se.index[term], doc.ID)
			}
		}
	}
}

// Search performs a search query
func (se *SearchEngine) Search(query string) []*SearchResult {
	terms := tokenize(query)
	if len(terms) == 0 {
		return nil
	}

	// Find documents matching ALL terms
	docSets := make([]map[string]bool, len(terms))
	for i, term := range terms {
		docSets[i] = make(map[string]bool)
		for _, docID := range se.index[term] {
			docSets[i][docID] = true
		}
	}

	// Intersect all sets
	resultDocs := docSets[0]
	for i := 1; i < len(docSets); i++ {
		for docID := range resultDocs {
			if !docSets[i][docID] {
				delete(resultDocs, docID)
			}
		}
	}

	// Calculate scores and build results
	results := make([]*SearchResult, 0, len(resultDocs))
	for docID := range resultDocs {
		doc := se.documents[docID]
		score := calculateScore(query, doc)
		results = append(results, &SearchResult{
			DocumentID: docID,
			Content:   doc.Content,
			Score:    score,
		})
	}

	// Sort by score descending
	sort.Slice(results, func(i, j int) bool {
		return results[i].Score > results[j].Score
	})

	return results
}

// Suggest provides autocomplete suggestions
func (se *SearchEngine) Suggest(prefix string) []string {
	prefix = strings.ToLower(prefix)
	if prefix == "" {
		return nil
	}

	var suggestions []string
	for term := range se.index {
		if strings.HasPrefix(term, prefix) {
			suggestions = append(suggestions, term)
		}
	}

	sort.Strings(suggestions)
	if len(suggestions) > 10 {
		suggestions = suggestions[:10]
	}

	return suggestions
}

// Count returns the number of indexed documents
func (se *SearchEngine) Count() int {
	return len(se.documents)
}

// Clear clears the index
func (se *SearchEngine) Clear() {
	se.index = make(map[string][]string)
	se.documents = make(map[string]*Document)
}

// tokenize splits text into terms
func tokenize(text string) []string {
	text = strings.ToLower(text)
	// Remove punctuation
	reg := regexp.MustCompile(`[^\w\s]`)
	text = reg.ReplaceAllString(text, "")
	fields := strings.Fields(text)
	return fields
}

// calculateScore calculates relevance score
func calculateScore(query string, doc *Document) float64 {
	queryTerms := tokenize(query)
	docTerms := tokenize(doc.Content)

	matches := 0
	for _, qt := range queryTerms {
		for _, dt := range docTerms {
			if qt == dt {
				matches++
				break
			}
		}
	}

	// Score = matches / total query terms
	return float64(matches) / float64(len(queryTerms))
}

// ============================================================================
// FUZZY SEARCH
// ============================================================================

// FuzzySearchEngine extends search with fuzzy matching
type FuzzySearchEngine struct {
	*SearchEngine
}

// NewFuzzySearchEngine creates a fuzzy search engine
func NewFuzzySearchEngine() *FuzzySearchEngine {
	return &FuzzySearchEngine{
		SearchEngine: NewSearchEngine(),
	}
}

// SearchFuzzy performs fuzzy search
func (fse *FuzzySearchEngine) SearchFuzzy(query string, maxDistance int) []*SearchResult {
	terms := tokenize(query)
	if len(terms) == 0 {
		return nil
	}

	// Similar documents (any term match)
	similarDocs := make(map[string]int)
	for _, term := range terms {
		for docID := range fse.documents {
			similarDocs[docID] = 0
		}
	}

	// Calculate fuzzy scores
	results := make([]*SearchResult, 0)
	for docID := range similarDocs {
		doc := fse.documents[docID]
		score := calculateFuzzyScore(query, doc, maxDistance)
		if score > 0 {
			results = append(results, &SearchResult{
				DocumentID: docID,
				Content:    doc.Content,
				Score:      score,
			})
		}
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].Score > results[j].Score
	})

	return results
}

// calculateFuzzyScore calculates fuzzy match score
func calculateFuzzyScore(query string, doc *Document, maxDistance int) float64 {
	queryTerms := tokenize(query)
	docTerms := tokenize(doc.Content)

	matches := 0
	for _, qt := range queryTerms {
		for _, dt := range docTerms {
			if levenshteinDistance(qt, dt) <= maxDistance {
				matches++
				break
			}
		}
	}

	return float64(matches) / float64(len(queryTerms))
}

// levenshteinDistance calculates edit distance
func levenshteinDistance(s1, s2 string) int {
	if len(s1) == 0 {
		return len(s2)
	}
	if len(s2) == 0 {
		return len(s1)
	}

	matrix := make([][]int, len(s1)+1)
	for i := range matrix {
		matrix[i] = make([]int, len(s2)+1)
	}

	for i := 0; i <= len(s1); i++ {
		matrix[i][0] = i
	}
	for j := 0; j <= len(s2); j++ {
		matrix[0][j] = j
	}

	for i := 1; i <= len(s1); i++ {
		for j := 1; j <= len(s2); j++ {
			cost := 1
			if s1[i-1] == s2[j-1] {
				cost = 0
			}
			matrix[i][j] = min(
				matrix[i-1][j]+1,
				matrix[i][j-1]+1,
				matrix[i-1][j-1]+cost,
			)
		}
	}

	return matrix[len(s1)][len(s2)]
}

func min(a, b, c int) int {
	if a < b {
		if a < c {
			return a
		}
		return c
	}
	if b < c {
		return b
	}
	return c
}

// ============================================================================
// EXAMPLE USAGE
// ============================================================================

func main() {
	se := NewSearchEngine()

	// Index documents
	se.IndexDocument(&Document{
		ID:      "1",
		Content: "Bitcoin price chart analysis",
		Fields:  map[string]string{"symbol": "BTC"},
	})

	se.IndexDocument(&Document{
		ID:      "2",
		Content: "Ethereum price chart analysis",
		Fields:  map[string]string{"symbol": "ETH"},
	})

	se.IndexDocument(&Document{
		ID:      "3",
		Content: "Crypto trading signals",
		Fields:  map[string]string{"type": "signals"},
	})

	// Search
	results := se.Search("bitcoin")
	fmt.Printf("Search results: %+v\n", results)

	// Suggest
	suggestions := se.Suggest("bit")
	fmt.Printf("Suggestions: %v\n", suggestions)

	// Count
	fmt.Printf("Indexed documents: %d\n", se.Count())

	// Fuzzy search
	fse := NewFuzzySearchEngine()
	fse.IndexDocument(&Document{ID: "1", Content: "Bitcoin price"})
	fse.IndexDocument(&Document{ID: "2", Content: "Bitcorn price"})
	fse.IndexDocument(&Document{ID: "3", Content: "Ethereum price"})

	fuzzyResults := fse.SearchFuzzy("bitcoin", 2)
	fmt.Printf("Fuzzy results: %+v\n", fuzzyResults)
}