package main

import (
	"fmt"
	"sync"
	"time"
)

// ============================================================================
// JOB SCHEDULER - Go Implementation
// High-performance job scheduling for TigerEx
// ============================================================================

// JobFunc is the job function type
type JobFunc func() error

// Job represents a scheduled job
type Job struct {
	ID        string
	Interval time.Duration
	JobFunc JobFunc
	LastRun time.Time
	NextRun time.Time
}

// Scheduler manages job scheduling
type Scheduler struct {
	mu      sync.RWMutex
	jobs    map[string]*Job
	stopCh  chan struct{}
	wg      sync.WaitGroup
	running bool
}

// NewScheduler creates a new scheduler
func NewScheduler() *Scheduler {
	return &Scheduler{
		jobs:   make(map[string]*Job),
		stopCh: make(chan struct{}),
	}
}

// Schedule adds a recurring job
func (s *Scheduler) Schedule(id string, interval time.Duration, fn JobFunc) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	job := &Job{
		ID:        id,
		Interval: interval,
		JobFunc:  fn,
		LastRun:  time.Now(),
		NextRun:  time.Now().Add(interval),
	}
	s.jobs[id] = job
}

// ScheduleOnce schedules a one-time job
func (s *Scheduler) ScheduleOnce(id string, delay time.Duration, fn JobFunc) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	job := &Job{
		ID:        id,
		Interval: 0, // One-time
		JobFunc:  fn,
		LastRun:  time.Now(),
		NextRun:  time.Now().Add(delay),
	}
	s.jobs[id] = job
}

// Start starts the scheduler
func (s *Scheduler) Start() {
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return
	}
	s.running = true
	s.mu.Unlock()
	
	go s.runLoop()
}

// Stop stops the scheduler
func (s *Scheduler) Stop() {
	s.mu.Lock()
	if !s.running {
		s.mu.Unlock()
		return
	}
	s.running = false
	close(s.stopCh)
	s.mu.Unlock()
	
	s.wg.Wait()
}

// Remove deletes a job
func (s *Scheduler) Remove(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.jobs, id)
}

// ListJobs returns all job IDs
func (s *Scheduler) ListJobs() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	jobs := make([]string, 0, len(s.jobs))
	for id := range s.jobs {
		jobs = append(jobs, id)
	}
	return jobs
}

func (s *Scheduler) runLoop() {
	s.wg.Add(1)
	defer s.wg.Done()
	
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	
	for {
		select {
		case <-s.stopCh:
			return
		case <-ticker.C:
			s.runPendingJobs()
		}
	}
}

func (s *Scheduler) runPendingJobs() {
	now := time.Now()
	
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	for _, job := range s.jobs {
		if now.After(job.NextRun) {
			go func(j *Job) {
				if err := j.JobFunc(); err != nil {
					fmt.Printf("Job %s error: %v\n", j.ID, err)
				}
			}(job)
			
			job.LastRun = now
			if job.Interval > 0 {
				job.NextRun = now.Add(job.Interval)
			} else {
				// One-time job, remove after run
				s.mu.Lock()
				delete(s.jobs, job.ID)
				s.mu.Unlock()
			}
		}
	}
}

// JobResult represents job execution result
type JobResult struct {
	JobID    string    `json:"jobId"`
	Success bool      `json:"success"`
	Error   string    `json:"error,omitempty"`
	RunAt   time.Time `json:"runAt"`
}

// Status returns scheduler status
func (s *Scheduler) Status() map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	status := map[string]interface{}{
		"running": s.running,
		"jobs":    len(s.jobs),
	}
	
	jobs := make([]map[string]interface{}, 0)
	for _, job := range s.jobs {
		jobs = append(jobs, map[string]interface{}{
			"id":       job.ID,
			"interval": job.Interval.String(),
			"nextRun":  job.NextRun.Format(time.RFC3339),
		})
	}
	status["jobList"] = jobs
	
	return status
}

// ============================================================================
// EXAMPLE USAGE
// ============================================================================

func main() {
	scheduler := NewScheduler()
	
	// Schedule recurring jobs
	scheduler.Schedule("cleanup", 5*time.Second, func() error {
		fmt.Println("Running cleanup job...")
		return nil
	})
	
	scheduler.Schedule("healthcheck", 10*time.Second, func() error {
		fmt.Println("Running health check...")
		return nil
	})
	
	// Schedule one-time job
	scheduler.ScheduleOnce("delayed", 2*time.Second, func() error {
		fmt.Println("Delayed job ran!")
		return nil
	})
	
	// Start scheduler
	scheduler.Start()
	
	// List jobs
	fmt.Printf("Scheduled jobs: %v\n", scheduler.ListJobs())
	
	// Show status
	fmt.Printf("Status: %+v\n", scheduler.Status())
	
	// Run for a bit
	time.Sleep(3 * time.Second)
	
	// Stop scheduler
	scheduler.Stop()
	
	fmt.Println("Scheduler stopped")
}