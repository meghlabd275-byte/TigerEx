// Package search - Search Index
package main

import (
	"fmt"
	"sort"
)

type Doc struct {
	ID     string
	Score  float64
}

type Index struct {
	docs map[string][]Doc
}

func New() *Index {
	return &Index{docs: make(map[string][]Doc)}
}

func (idx *Index) Add(term, docID string, score float64) {
	idx.docs[term] = append(idx.docs[term], Doc{ID: docID, Score: score})
}

func (idx *Index) Search(term string) []Doc {
	docs := idx.docs[term]
	sort.Slice(docs, func(i, j int) bool {
		return docs[i].Score > docs[j].Score
	})
	return docs
}

func main() {
	idx := New()
	idx.Add("bitcoin", "doc1", 0.9)
	idx.Add("bitcoin", "doc2", 0.7)
	fmt.Println(idx.Search("bitcoin"))
}