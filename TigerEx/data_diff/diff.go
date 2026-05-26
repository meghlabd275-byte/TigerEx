package main

import (
	"fmt"
	"reflect"
	"sort"
)

// ============================================================================
// DATA DIFF - Go Implementation
// Efficient diff computation for TigerEx
// ============================================================================

// Diff represents a computed diff
type Diff struct {
	Added   []string        `json:"added"`
	Removed []string        `json:"removed"`
	Changed [][2]string     `json:"changed"`
}

// ComputeDiff computes diff between two slices
func ComputeDiff(oldVals, newVals []string) *Diff {
	oldSet := make(map[string]bool)
	newSet := make(map[string]bool)

	for _, v := range oldVals {
		oldSet[v] = true
	}
	for _, v := range newVals {
		newSet[v] = true
	}

	var added, removed []string
	for _, v := range newVals {
		if !oldSet[v] {
			added = append(added, v)
		}
	}
	for _, v := range oldVals {
		if !newSet[v] {
			removed = append(removed, v)
		}
	}

	return &Diff{
		Added:   added,
		Removed: removed,
	}
}

// ComputeMapDiff computes diff between two maps
func ComputeMapDiff(oldMap, newMap map[string]interface{}) *Diff {
	var added, removed []string

	for k := range newMap {
		if _, ok := oldMap[k]; !ok {
			added = append(added, k)
		}
	}
	for k := range oldMap {
		if _, ok := newMap[k]; !ok {
			removed = append(removed, k)
		}
	}

	return &Diff{
		Added:   added,
		Removed: removed,
	}
}

// UnifiedDiff returns unified diff format
func UnifiedDiff(oldVals, newVals []string) []string {
	diff := ComputeDiff(oldVals, newVals)

	var result []string
	for _, v := range diff.Removed {
		result = append(result, "-"+v)
	}
	for _, v := range diff.Added {
		result = append(result, "+"+v)
	}

	return result
}

// PrettyPrint prints diff nicely
func PrettyPrint(d *Diff) string {
	result := ""
	if len(d.Added) > 0 {
		result += "Added:\n"
		for _, v := range d.Added {
			result += fmt.Sprintf("  + %s\n", v)
		}
	}
	if len(d.Removed) > 0 {
		result += "Removed:\n"
		for _, v := range d.Removed {
			result += fmt.Sprintf("  - %s\n", v)
		}
	}
	return result
}

// ============================================================================
// EXAMPLE USAGE
// ============================================================================

func main() {
	oldVals := []string{"a", "b", "c"}
	newVals := []string{"a", "b", "d", "e"}

	diff := ComputeDiff(oldVals, newVals)
	fmt.Printf("Diff: %+v\n", diff)

	// Map diff
	oldMap := map[string]interface{}{"a": 1, "b": 2}
	newMap := map[string]interface{}{"a": 1, "c": 3}

	mapDiff := ComputeMapDiff(oldMap, newMap)
	fmt.Printf("Map diff: %+v\n", mapDiff)

	// Pretty print
	result := PrettyPrint(mapDiff)
	fmt.Printf("%s\n", result)

	// Sort values for consistent output
	_ = sort
	_ = reflect.TypeOf(nil)
}