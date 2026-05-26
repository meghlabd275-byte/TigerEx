// Package session - Session Manager
package main

import (
	"fmt"
	"sync"
	"time"
)

type Session struct {
	ID string
	UserID string
	Token string
	CreatedAt time.Time
	ExpiresAt time.Time
	Data map[string]interface{}
}

type SessionManager struct {
	mu sync.RWMutex
	sessions map[string]*Session
	counter uint64
}

func NewSessionManager() *SessionManager {
	return &SessionManager{
		sessions: make(map[string]*Session),
	}
}

func (sm *SessionManager) Create(userID string, expiry time.Duration) (*Session, error) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	sm.counter++
	token := fmt.Sprintf("tok_%d", sm.counter)
	session := &Session{
		ID: fmt.Sprintf("sess_%d", sm.counter),
		UserID: userID,
		Token: token,
		CreatedAt: time.Now(),
		ExpiresAt: time.Now().Add(expiry),
		Data: make(map[string]interface{}),
	}

	sm.sessions[session.ID] = session
	return session, nil
}

func (sm *SessionManager) Get(id string) *Session {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	session, ok := sm.sessions[id]
	if !ok {
		return nil
	}

	if time.Now().After(session.ExpiresAt) {
		return nil
	}

	return session
}

func (sm *SessionManager) Delete(id string) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	delete(sm.sessions, id)
}

func (sm *SessionManager) Cleanup() int {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	count := 0
	now := time.Now()
	for id, sess := range sm.sessions {
		if now.After(sess.ExpiresAt) {
			delete(sm.sessions, id)
			count++
		}
	}
	return count
}

func main() {
	sm := NewSessionManager()

	sess, _ := sm.Create("user1", 30*time.Minute)
	fmt.Printf("Session: %s\n", sess.ID)

	found := sm.Get(sess.ID)
	if found != nil {
		fmt.Printf("Found: %s\n", found.UserID)
	}

	sm.Delete(sess.ID)
}