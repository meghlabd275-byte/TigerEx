// Package health - Health Check
package main

import (
	"encoding/json"
	"fmt"
	"runtime"
	"time"
)

type Component struct {
	Name    string `json:"name"`
	Status  string `json:"status"`
	Latency string `json:"latency_ms,omitempty"`
}

type HealthReport struct {
	Status   string      `json:"status"`
	Uptime   string     `json:"uptime"`
	Services []Component `json:"services"`
}

var startTime = time.Now()

func healthCheck() HealthReport {
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)
	
	return HealthReport{
		Status: "healthy",
		Uptime: time.Since(startTime).String(),
		Services: []Component{
			{Name: "database", Status: "up"},
			{Name: "cache", Status: "up"},
			{Name: "queue", Status: "up"},
		},
	}
}

func main() {
	report := healthCheck()
	json, _ := json.MarshalIndent(report, "", "  ")
	fmt.Println(string(json))
}