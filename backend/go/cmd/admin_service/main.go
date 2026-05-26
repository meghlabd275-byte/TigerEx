// Package admin_service provides admin backend control.
// Migrated from TypeScript to Go for admin operations.
package main

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"
)

// User info for admin view
type UserInfo struct {
	ID           string   `json:"id"`
	Email        string   `json:"email"`
	KYCLevel     int      `json:"kycLevel"`
	Status      string   `json:"status"`
	CreatedAt   int64    `json:"createdAt"`
	LastLogin   int64    `json:"lastLogin"`
	AccountAge int64    `json:"accountAge"`
}

// Admin action
type AdminAction struct {
	ID        string `json:"id"`
	AdminID  string `json:"adminId"`
	UserID   string `json:"userId"`
	Action   string `json:"action"` // freeze, unfreeze, kyc_approve, kyc_reject
	Reason   string `json:"reason"`
	Metadata string `json:"metadata"`
	Result   string `json:"result"`
	Timestamp int64  `json:"timestamp"`
}

// KYC submission
type KYCSubmission struct {
	UserID     string `json:"userId"`
	FirstName  string `json:"firstName"`
	LastName   string `json:"lastName"`
	Country   string `json:"country"`
	IDType    string `json:"idType"`
	IDNumber  string `json:"idNumber"`
	Status    string `json:"status"` // pending, approved, rejected
	SubmittedAt int64 `json:"submittedAt"`
	ReviewedAt int64 `json:"reviewedAt"`
	ReviewerID string `json:"reviewerId"`
}

// Export job
type ExportJob struct {
	ID        string `json:"id"`
	Type     string `json:"type"` // users, trades, transactions
	Filter   string `json:"filter"`
	Status   string `json:"status"` // pending, processing, completed, failed
	FileURL  string `json:"fileUrl"`
	StartedAt int64  `json:"startedAt"`
	CompletedAt int64 `json:"completedAt"`
}

// Admin store
type AdminStore struct {
	mu          sync.RWMutex
	users      map[string]*UserInfo
	actions    []*AdminAction
	kycSubs    map[string]*KYCSubmission
	exports    map[string]*ExportJob
}

var (
	aStore = &AdminStore{
		users:   make(map[string]*UserInfo),
		actions: make([]*AdminAction, 0),
		kycSubs: make(map[string]*KYCSubmission),
		exports: make(map[string]*ExportJob),
	}
)

// Freeze user account
func FreezeUser(adminID, userID, reason string) (*AdminAction, error) {
	user, ok := aStore.users[userID]
	if !ok {
		return nil, fmt.Errorf("user not found")
	}

	user.Status = "frozen"

	action := &AdminAction{
		ID:        fmt.Sprintf("action_%d", time.Now().UnixNano()),
		AdminID:  adminID,
		UserID:   userID,
		Action:   "freeze",
		Reason:   reason,
		Result:   "success",
		Timestamp: time.Now().UnixMilli(),
	}

	aStore.mu.Lock()
	defer aStore.mu.Unlock()
	aStore.actions = append(aStore.actions, action)

	return action, nil
}

// Unfreeze user account
func UnfreezeUser(adminID, userID, reason string) (*AdminAction, error) {
	user, ok := aStore.users[userID]
	if !ok {
		return nil, fmt.Errorf("user not found")
	}

	user.Status = "active"

	action := &AdminAction{
		ID:        fmt.Sprintf("action_%d", time.Now().UnixNano()),
		AdminID:  adminID,
		UserID:   userID,
		Action:   "unfreeze",
		Reason:   reason,
		Result:   "success",
		Timestamp: time.Now().UnixMilli(),
	}

	aStore.mu.Lock()
	defer aStore.mu.Unlock()
	aStore.actions = append(aStore.actions, action)

	return action, nil
}

// Approve KYC
func ApproveKYC(adminID, userID string) (*KYCSubmission, error) {
	sub, ok := aStore.kycSubs[userID]
	if !ok {
		return nil, fmt.Errorf("KYC submission not found")
	}

	sub.Status = "approved"
	sub.ReviewedAt = time.Now().UnixMilli()
	sub.ReviewerID = adminID

	// Also update user level
	user, userOk := aStore.users[userID]
	if userOk {
		user.KYCLevel = 2
	}

	return sub, nil
}

// Reject KYC
func RejectKYC(adminID, userID, reason string) (*KYCSubmission, error) {
	sub, ok := aStore.kycSubs[userID]
	if !ok {
		return nil, fmt.Errorf("KYC submission not found")
	}

	sub.Status = "rejected"
	sub.ReviewedAt = time.Now().UnixMilli()
	sub.ReviewerID = adminID

	return sub, nil
}

// Start export job
func StartExport(jobType, filter string) *ExportJob {
	job := &ExportJob{
		ID:        fmt.Sprintf("export_%d", time.Now().UnixNano()),
		Type:     jobType,
		Filter:   filter,
		Status:   "processing",
		StartedAt: time.Now().UnixMilli(),
	}

	aStore.mu.Lock()
	defer aStore.mu.Unlock()
	aStore.exports[job.ID] = job

	return job
}

// Get export job status
func GetExportStatus(jobID string) (*ExportJob, bool) {
	aStore.mu.RLock()
	defer aStore.mu.RUnlock()

	j, ok := aStore.exports[jobID]
	return j, ok
}

// Get user by ID
func GetUser(userID string) (*UserInfo, bool) {
	aStore.mu.RLock()
	defer aStore.mu.RUnlock()

	u, ok := aStore.users[userID]
	return u, ok
}

// List users with filters
func ListUsers(status string, limit int) []*UserInfo {
	aStore.mu.RLock()
	defer aStore.mu.RUnlock()

	var result []*UserInfo
	for _, u := range aStore.users {
		if status != "" && u.Status != status {
			continue
		}
		result = append(result, u)
		if len(result) >= limit {
			break
		}
	}
	return result
}

// Get audit trail
func GetAuditTrail(userID string) []*AdminAction {
	aStore.mu.RLock()
	defer aStore.mu.RUnlock()

	var result []*AdminAction
	for _, a := range aStore.actions {
		if a.UserID == userID {
			result = append(result, a)
		}
	}
	return result
}

func main() {
	fmt.Println("Admin service initialized")

	// Demo
	user := &UserInfo{
		ID:        "user_demo",
		Email:     "demo@example.com",
		KYCLevel:  1,
		Status:    "active",
		CreatedAt: time.Now().UnixMilli() - 86400000*30, // 30 days ago
		LastLogin: time.Now().UnixMilli(),
	}
	
	aStore.mu.Lock()
	aStore.users[user.ID] = user
	aStore.mu.Unlock()

	// Freeze demo
	action, err := FreezeUser("admin_1", user.ID, "Test freeze")
	if err == nil {
		fmt.Printf("Frozen user: %s\n", action.Result)
	}
}