// Package worker - Background Worker Pool
package main

import (
	"fmt"
	"sync"
	"time"
)

type Job struct {
	ID string
	Payload string
	Handler func()
}

type Worker struct {
	id int
	jobs chan Job
}

type WorkerPool struct {
	size int
	workers []Worker
	jobs chan Job
	wg sync.WaitGroup
}

func NewWorkerPool(size int) *WorkerPool {
	return &WorkerPool{
		size: size,
		jobs: make(chan Job, 1000),
	}
}

func (wp *WorkerPool) Start() {
	for i := 0; i < wp.size; i++ {
		wp.wg.Add(1)
		go func(wid int) {
			defer wp.wg.Done()
			for job := range wp.jobs {
				fmt.Printf("Worker %d processing job %s\n", wid, job.ID)
				time.Sleep(100 * time.Millisecond)
			}
		}(i)
	}
}

func (wp *WorkerPool) Submit(job Job) {
	wp.jobs <- job
}

func (wp *WorkerPool) Stop() {
	close(wp.jobs)
	wp.wg.Wait()
}

func main() {
	pool := NewWorkerPool(5)
	pool.Start()
	
	pool.Submit(Job{ID: "job1", Payload: "data"})
	pool.Submit(Job{ID: "job2", Payload: "data"})
	
	time.Sleep(500 * time.Millisecond)
	pool.Stop()
	
	fmt.Println("Done")
}