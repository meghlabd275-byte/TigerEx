// Package metrics - Metrics Collection
package main

import (
	"encoding/json"
	"fmt"
	"runtime"
	"time"
)

type Metric struct {
	Name  string  `json:"name"`
	Value float64 `json:"value"`
	Time  int64   `json:"time"`
}

type Collector struct {
	metrics []Metric
}

func New() *Collector {
	return &Collector{metrics: []Metric{}}
}

func (c *Collector) Record(name string, value float64) {
	c.metrics = append(c.metrics, Metric{
		Name:  name,
		Value: value,
		Time:  time.Now().Unix(),
	})
}

func (c *Collector) Get(name string) []Metric {
	var result []Metric
	for _, m := range c.metrics {
		if m.Name == name {
			result = append(result, m)
		}
	}
	return result
}

func (c *Collector) Snapshot() map[string]interface{} {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	
	return map[string]interface{}{
		"goroutines":  runtime.NumGoroutine(),
		"memory_mb":   m.Alloc / 1024 / 1024,
		"total_alloc":  m.TotalAlloc,
		"sys":         m.Sys,
	}
}

func main() {
	c := New()
	c.Record("orders", 1000)
	c.Record("latency", 50.5)
	fmt.Println(c.Snapshot())
}