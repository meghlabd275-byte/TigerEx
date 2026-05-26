package main

import (
	"fmt"
	"sync"
	"time"
)

// ============================================================================
// DISTRIBUTED LOCK - Go Implementation
// Distributed locking for TigerEx
// ============================================================================

// Lock represents a distributed lock
type DistLock struct {
	name   string
	mu     sync.Mutex
	heldBy string
	locked bool
}

// NewDistLock creates a new distributed lock
func NewDistLock(name string) *DistLock {
	return &DistLock{
		name: name,
	}
}

// Acquire acquires the lock
func (dl *DistLock) Acquire(holder string, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)

	for time.Now().Before(deadline) {
		if dl.tryAcquire(holder) {
			return true
		}
		time.Sleep(10 * time.Millisecond)
	}
	return false
}

// TryAcquire tries to acquire without blocking
func (dl *DistLock) TryAcquire(holder string) bool {
	return dl.tryAcquire(holder)
}

func (dl *DistLock) tryAcquire(holder string) bool {
	dl.mu.Lock()
	defer dl.mu.Unlock()

	if dl.locked {
		return false
	}
	dl.locked = true
	dl.heldBy = holder
	return true
}

// Release releases the lock
func (dl *DistLock) Release(holder string) bool {
	dl.mu.Lock()
	defer dl.mu.Unlock()

	if dl.heldBy == holder {
		dl.locked = false
		dl.heldBy = ""
		return true
	}
	return false
}

// IsLocked checks if locked
func (dl *DistLock) IsLocked() bool {
	dl.mu.Lock()
	defer dl.mu.Unlock()
	return dl.locked
}

// Holder returns current holder
func (dl *DistLock) Holder() string {
	dl.mu.Lock()
	defer dl.mu.Unlock()
	return dl.heldBy
}

// ============================================================================
// LOCK MANAGER
// ============================================================================

// LockManager manages multiple locks
type LockManager struct {
	mu    sync.RWMutex
	locks map[string]*DistLock
}

// NewLockManager creates a new lock manager
func NewLockManager() *LockManager {
	return &LockManager{
		locks: make(map[string]*DistLock),
	}
}

// GetLock gets a lock by name
func (lm *LockManager) GetLock(name string) *DistLock {
	lm.mu.Lock()
	defer lm.mu.Unlock()

	if lock, ok := lm.locks[name]; ok {
		return lock
	}

	lock := NewDistLock(name)
	lm.locks[name] = lock
	return lock
}

// ============================================================================
// RWLOCK
// ============================================================================

// ReadWriteLock provides read-write locking
type RWLock struct {
	mu         sync.RWMutex
	readers    int
	writers    int
	readWait   chan struct{}
	writeWait  chan struct{}
}

// NewRWLock creates a new read-write lock
func NewRWLock() *RWLock {
	return &RWLock{
		readWait:  make(chan struct{}),
		writeWait: make(chan struct{}),
	}
}

// RLock acquires read lock
func (rw *RWLock) RLock() {
	rw.mu.Lock()
	if rw.writers > 0 {
		rw.mu.Unlock()
		<-rw.readWait
	}
	rw.readers++
	rw.mu.Unlock()
}

// RUnlock releases read lock
func (rw *RWLock) RUnlock() {
	rw.mu.Lock()
	rw.readers--
	if rw.readers == 0 && rw.writers > 0 {
		rw.writeWait <- struct{}{}
	}
	rw.mu.Unlock()
}

// Lock acquires write lock
func (rw *RWLock) Lock() {
	rw.mu.Lock()
	rw.writers++
	if rw.readers > 0 {
		rw.mu.Unlock()
		<-rw.writeWait
	}
}

// Unlock releases write lock
func (rw *RWLock) Unlock() {
	rw.mu.Unlock()
	rw.writers--
	close(rw.readWait)
}

// ============================================================================
// EXAMPLE USAGE
// ============================================================================

func main() {
	// Basic lock
	lock := NewDistLock("resource1")
	
	acquired := lock.Acquire("client1", 1*time.Second)
	fmt.Printf("Acquired: %v\n", acquired)
	
	fmt.Printf("Locked: %v\n", lock.IsLocked())
	fmt.Printf("Holder: %s\n", lock.Holder())
	
	released := lock.Release("client1")
	fmt.Printf("Released: %v\n", released)
	fmt.Printf("Locked after release: %v\n", lock.IsLocked())
	
	// Try acquire
	lock.TryAcquire("client2")
	fmt.Printf("client2 holder: %s\n", lock.Holder())
	
	// Lock manager
	lm := NewLockManager()
	res1 := lm.GetLock("resource1")
	res1.TryAcquire("user1")
	fmt.Printf("Manager lock held by: %s\n", res1.Holder())
}