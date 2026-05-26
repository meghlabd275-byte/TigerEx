// Package monitor - Process Monitor
package main

import (
	"fmt"
	"os"
	"runtime"
	"time"
)

type Stats struct {
	CPU     float64
	Memory  uint64
	Gorount int
}

func GetStats() Stats {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	return Stats{
		CPU:    0,
		Memory: m.Alloc,
		Gorount: runtime.NumGoroutine(),
	}
}

func main() {
	stats := GetStats()
	fmt.Printf("Goroutines: %d, Memory: %d\n", stats.Gorount, stats.Memory)
}