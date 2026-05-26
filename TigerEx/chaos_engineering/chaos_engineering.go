package main

import (
	"fmt"
	"time"
)

// Failure type
type FailureType string

const (
	FailureLatency FailureType = "latency"
	FailurePacketLoss FailureType = "packet_loss"
	FailureServerError FailureType = "server_error"
	FailureShutdown FailureType = "shutdown"
)

// Experiment status
type ExperimentStatus string

const (
	ExpRunning ExperimentStatus = "running"
	ExpCompleted ExperimentStatus = "completed"
	ExpStopped ExperimentStatus = "stopped"
)

// Experiment
type Experiment struct {
	ID          string           `json:"id"`
	Service    string          `json:"service"`
	FailureType FailureType   `json:"failureType"`
	Status     ExperimentStatus `json:"status"`
	StartedAt  int64           `json:"startedAt"`
	EndedAt    *int64          `json:"endedAt,omitempty"`
	Duration   int64           `json:"duration"`
}

// Game day
type GameDay struct {
	ID         string   `json:"id"`
	Name      string   `json:"name"`
	Services  []string `json:"services"`
	ScheduledFor int64  `json:"scheduledFor"`
	Status    string   `json:"status"`
}

// Chaos platform
type ChaosPlatform struct {
	Experiments map[string]*Experiment
	GameDays   map[string]*GameDay
}

// New creates platform
func NewChaosPlatform() *ChaosPlatform {
	return &ChaosPlatform{
		Experiments: make(map[string]*Experiment),
		GameDays: make(map[string]*GameDay),
	}
}

// Inject failure
func (c *ChaosPlatform) InjectFailure(service string, failureType FailureType, durationMs int64) *Experiment {
	id := fmt.Sprintf("exp_%d", time.Now().UnixNano())
	
	exp := &Experiment{
		ID: id,
		Service: service,
		FailureType: failureType,
		Status: ExpRunning,
		StartedAt: time.Now().UnixMilli(),
		Duration: durationMs,
	}
	
	c.Experiments[id] = exp
	
	// Auto complete after duration
	go func() {
		time.Sleep(time.Duration(durationMs) * time.Millisecond)
		if exp.Status == ExpRunning {
			now := time.Now().UnixMilli()
			exp.Status = ExpCompleted
			exp.EndedAt = &now
		}
	}()
	
	return exp
}

// Stop experiment
func (c *ChaosPlatform) StopExperiment(expID string) bool {
	exp, ok := c.Experiments[expID]
	if !ok {
		return false
	}
	
	now := time.Now().UnixMilli()
	exp.Status = ExpStopped
	exp.EndedAt = &now
	return true
}

// Schedule game day
func (c *ChaosPlatform) ScheduleGameDay(name string, services []string, scheduledFor int64) *GameDay {
	id := fmt.Sprintf("gd_%d", time.Now().UnixNano())
	
	gameDay := &GameDay{
		ID: id,
		Name: name,
		Services: services,
		ScheduledFor: scheduledFor,
		Status: "scheduled",
	}
	
	c.GameDays[id] = gameDay
	return gameDay
}

// Get status
func (c *ChaosPlatform) GetStatus() (healthy bool, activeCount int) {
	var active int
	for _, exp := range c.Experiments {
		if exp.Status == ExpRunning {
			active++
		}
	}
	return true, active
}

func main() {
	platform := NewChaosPlatform()
	
	// Inject latency
	exp := platform.InjectFailure("orderservice", FailureLatency, 5000)
	fmt.Printf("Experiment: %s (%s)\n", exp.ID, exp.FailureType)
	
	// Stop
	platform.StopExperiment(exp.ID)
	fmt.Printf("Status: %s\n", exp.Status)
	
	// Game day
	gd := platform.ScheduleGameDay("Q4 Drill", []string{"order", "wallet"}, time.Now().Add(7*24*time.Hour).UnixMilli())
	fmt.Printf("Game day: %s\n", gd.Name)
	
	// Status
	healthy, active := platform.GetStatus()
	fmt.Printf("Healthy: %v, Active: %d\n", healthy, active)
}