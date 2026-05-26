// Package scheduler provides job scheduling services.
// Migrated from TypeScript to Go for periodic tasks.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Job type
type JobType struct {
	ID          string  `json:"id"`
	Name       string  `json:"name"`
	Schedule   string  `json:"schedule"` // cron expression
	Handler    string  `json:"handler"` // service.method
	Interval   int64  `json:"interval"` // ms, 0 = cron
	Status     string  `json:"status"` // active, paused
	LastRun    int64   `json:"lastRun"`
	NextRun    int64   `json:"nextRun"`
}

// Job execution
type JobExecution struct {
	ID        string  `json:"id"`
	JobID    string  `json:"jobId"`
	StartedAt int64   `json:"startedAt"`
	Duration int64   `json:"duration"` // ms
	Status   string  `json:"status"` // running, success, failed
	Error    string  `json:"error"`
}

// Store
type SchedulerStore struct {
	mu        sync.RWMutex
	jobs      map[string]*JobType
	executions map[string]*JobExecution
}

var (
	schedStore = &SchedulerStore{
		jobs: make(map[string]*JobType),
		executions: make(map[string]*JobExecution),
	}
)

// Initialize jobs
func init() {
	jobs := []*JobType{
		{ID: "funding_distribution", Name: "Funding Distribution", Schedule: "@hourly", Handler: "funding.distribute", Interval: 3600000, Status: "active"},
		{ID: "interest_accrual", Name: "Interest Accrual", Schedule: "@daily", Handler: "savings.accrue", Interval: 86400000, Status: "active"},
		{ID: "order_expiration", Name: "Order Expiration", Schedule: "@minute", Handler: "order.expire", Interval: 60000, Status: "active"},
		{ID: "reward_distribution", Name: "Referral Rewards", Schedule: "@daily", Handler: "referral.distribute", Interval: 86400000, Status: "active"},
		{ID: "price_stream_update", Name: "Price Streams", Schedule: "@second", Handler: "price.update", Interval: 1000, Status: "active"},
		{ID: "settlement_batch", Name: "Settlement Batch", Schedule: "@daily", Handler: "settlement.batch", Interval: 86400000, Status: "active"},
		{ID: "liquidation_check", Name: "Liquidation Check", Schedule: "@second", Handler: "liquidation.check", Interval: 1000, Status: "active"},
		{ID: "health_check", Name: "Health Check", Schedule: "@minute", Handler: "health.check", Interval: 60000, Status: "active"},
		{ID: "market_data_sync", Name: "Market Data Sync", Schedule: "@second", Handler: "market.sync", Interval: 5000, Status: "active"},
		{ID: "backup_database", Name: "Database Backup", Schedule: "0 2 * * *", Handler: "backup.db", Interval: 86400000, Status: "paused"},
	}

	schedStore.mu.Lock()
	defer schedStore.mu.Unlock()

	for _, j := range jobs {
		j.NextRun = time.Now().UnixMilli() + j.Interval
		schedStore.jobs[j.ID] = j
	}
}

// Run job immediately
func RunJob(jobID string) (*JobExecution, error) {
	schedStore.mu.RLock()
	job, ok := schedStore.jobs[jobID]
	schedStore.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("job not found")
	}

	exec := &JobExecution{
		ID: fmt.Sprintf("exec_%d", time.Now().UnixNano()),
		JobID: jobID,
		StartedAt: time.Now().UnixMilli(),
		Status: "running",
	}

	// Simulate execution
	exec.Duration = 100 // ms
	exec.Status = "success"

	schedStore.mu.Lock()
	defer schedStore.mu.Unlock()

	job.LastRun = time.Now().UnixMilli()
	job.NextRun = job.LastRun + job.Interval
	schedStore.executions[exec.ID] = exec

	return exec, nil
}

// Get scheduled jobs
func GetScheduledJobs() []*JobType {
	schedStore.mu.RLock()
	defer schedStore.mu.RUnlock()

	var result []*JobType
	for _, j := range schedStore.jobs {
		if j.Status == "active" {
			result = append(result, j)
		}
	}
	return result
}

// Get job executions
func GetExecutions(jobID string, limit int) []*JobExecution {
	schedStore.mu.RLock()
	defer schedStore.mu.RUnlock()

	var result []*JobExecution
	count := 0

	for _, e := range schedStore.executions {
		if e.JobID == jobID {
			result = append(result, e)
			count++
			if count >= limit {
				break
			}
		}
	}
	return result
}

// Pause job
func PauseJob(jobID string) error {
	schedStore.mu.Lock()
	defer schedStore.mu.Unlock()

	if job, ok := schedStore.jobs[jobID]; ok {
		job.Status = "paused"
		return nil
	}
	return fmt.Errorf("job not found")
}

// Resume job
func ResumeJob(jobID string) error {
	schedStore.mu.Lock()
	defer schedStore.mu.Unlock()

	if job, ok := schedStore.jobs[jobID]; ok {
		job.Status = "active"
		job.NextRun = time.Now().UnixMilli()
		return nil
	}
	return fmt.Errorf("job not found")
}

func main() {
	fmt.Println("Scheduler service initialized")

	// Run some jobs
	jobs := []string{"funding_distribution", "interest_accrual", "order_expiration"}

	for _, j := range jobs {
		exec, err := RunJob(j)
		if err != nil {
			fmt.Printf("Error: %v\n", err)
		} else {
			fmt.Printf("Job %s: %s (took %dms)\n", j, exec.Status, exec.Duration)
		}
	}

	// Next runs
	nextRuns := GetScheduledJobs()
	fmt.Printf("Active jobs: %d\n", len(nextRuns))
}