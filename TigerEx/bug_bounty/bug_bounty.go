package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"
)

// ============================================================================
// BUG BOUNTY PROGRAM
// Security vulnerability disclosure and reward program
// ============================================================================

// ============================================================================
// TYPES
// ============================================================================

// Severity represents vulnerability severity
type Severity string

const (
	SeverityCritical Severity = "CRITICAL"
	SeverityHigh     Severity = "HIGH"
	SeverityMedium   Severity = "MEDIUM"
	SeverityLow      Severity = "LOW"
	SeverityInfo     Severity = "INFO"
)

// BugReport represents a bug report
type BugReport struct {
	ID          string
	ReporterID  string
	Title       string
	Description string
	Severity   Severity
	Status     ReportStatus
	Category   string
	StepsToReproduce string
	Impact     string
	Fix        string
	Reward     float64
	CreatedAt  time.Time
	UpdatedAt  time.Time
	ResolvedAt *time.Time
}

// ReportStatus represents bug report status
type ReportStatus string

const (
	ReportStatusSubmitted   ReportStatus = "SUBMITTED"
	ReportStatusTriaged   ReportStatus = "TRIAGED"
	ReportStatusConfirmed ReportStatus = "CONFIRMED"
	ReportStatusInProgress ReportStatus = "IN_PROGRESS"
	ReportStatusFixed    ReportStatus = "FIXED"
	ReportStatusClosed   ReportStatus = "CLOSED"
	ReportStatusRejected ReportStatus = "REJECTED"
)

// Hacker represents a registered hacker
type Hacker struct {
	ID          string
	Username    string
	Email       string
	Reputation  float64
	ReportsCount int64
	TotalReward float64
	JoinedAt   time.Time
	LastActive time.Time
}

// ============================================================================
// SERVICE
// ============================================================================

// Service manages bug bounty program
type Service struct {
	mu          sync.RWMutex
	reports    map[string]*BugReport
	hackers    map[string]*Hacker
	rewards    map[Severity]float64
	
	reportCounter int64
	hackerCounter int64
}

func NewService() *Service {
	s := &Service{
		reports: make(map[string]*BugReport),
		hackers: make(map[string]*Hacker),
		rewards: map[Severity]float64{
			SeverityCritical: 10000,
			SeverityHigh:     5000,
			SeverityMedium:   2000,
			SeverityLow:      500,
			SeverityInfo:     100,
		},
	}
	
	return s
}

// ============================================================================
// REGISTRATION & SUBMISSION
// ============================================================================

// RegisterHacker registers a new hacker
func (s *Service) RegisterHacker(username, email string) (*Hacker, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	// Check if exists
	for _, h := range s.hackers {
		if h.Email == email {
			return nil, fmt.Errorf("email already registered")
		}
	}
	
	s.hackerCounter++
	hacker := &Hacker{
		ID:         fmt.Sprintf("HACKER%d", s.hackerCounter),
		Username:   username,
		Email:     email,
		Reputation: 0,
		JoinedAt:  time.Now(),
		LastActive: time.Now(),
	}
	
	s.hackers[hacker.ID] = hacker
	return hacker, nil
}

// SubmitReport submits a bug report
func (s *Service) SubmitReport(reporterID, title, description, category, stepsToReproduce, impact string, severity Severity) (*BugReport, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	// Validate hacker exists
	hacker, ok := s.hackers[reporterID]
	if !ok {
		return nil, fmt.Errorf("hacker not registered")
	}
	
	s.reportCounter++
	report := &BugReport{
		ID:                fmt.Sprintf("REPORT%d", s.reportCounter),
		ReporterID:        reporterID,
		Title:            title,
		Description:      description,
		Severity:        severity,
		Status:          ReportStatusSubmitted,
		Category:        category,
		StepsToReproduce: stepsToReproduce,
		Impact:          impact,
		CreatedAt:       time.Now(),
		UpdatedAt:       time.Now(),
	}
	
	s.reports[report.ID] = report
	hacker.ReportsCount++
	hacker.LastActive = time.Now()
	
	return report, nil
}

// ============================================================================
// REVIEW & RESOLUTION
// ============================================================================

// Triage triages a report
func (s *Service) Triage(reportID string, severity Severity) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	report, ok := s.reports[reportID]
	if !ok {
		return fmt.Errorf("report not found")
	}
	
	if report.Status != ReportStatusSubmitted {
		return fmt.Errorf("invalid status")
	}
	
	report.Severity = severity
	report.Status = ReportStatusTriaged
	report.UpdatedAt = time.Now()
	
	return nil
}

// Confirm confirms a report
func (s *Service) Confirm(reportID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	report, ok := s.reports[reportID]
	if !ok {
		return fmt.Errorf("report not found")
	}
	
	if report.Status != ReportStatusTriaged {
		return fmt.Errorf("must be triaged first")
	}
	
	report.Status = ReportStatusConfirmed
	report.UpdatedAt = time.Now()
	
	return nil
}

// Reject rejects a report
func (s *Service) Reject(reportID, reason string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	report, ok := s.reports[reportID]
	if !ok {
		return fmt.Errorf("report not found")
	}
	
	report.Status = ReportStatusRejected
	report.UpdatedAt = time.Now()
	
	return nil
}

// Fix marks a report as fixed
func (s *Service) Fix(reportID, fix string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	report, ok := s.reports[reportID]
	if !ok {
		return fmt.Errorf("report not found")
	}
	
	if report.Status != ReportStatusConfirmed {
		return fmt.Errorf("must be confirmed first")
	}
	
	report.Status = ReportStatusFixed
	report.Fix = fix
	report.UpdatedAt = time.Now()
	
	// Calculate reward
	reward := s.rewards[report.Severity]
	report.Reward = reward
	
	// Update hacker reputation
	hacker, _ := s.hackers[report.ReporterID]
	if hacker != nil {
		hacker.TotalReward += reward
		hacker.Reputation += s.calculateReputation(report.Severity)
	}
	
	return nil
}

// Close closes a report
func (s *Service) Close(reportID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	report, ok := s.reports[reportID]
	if !ok {
		return fmt.Errorf("report not found")
	}
	
	now := time.Now()
	report.Status = ReportStatusClosed
	report.ResolvedAt = &now
	report.UpdatedAt = time.Now()
	
	return nil
}

// ============================================================================
// QUERIES
// ============================================================================

// GetReport gets a report
func (s *Service) GetReport(reportID string) (*BugReport, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	report, ok := s.reports[reportID]
	if !ok {
		return nil, fmt.Errorf("report not found")
	}
	
	return report, nil
}

// GetHacker gets hacker info
func (s *Service) GetHacker(hackerID string) (*Hacker, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	hacker, ok := s.hackers[hackerID]
	if !ok {
		return nil, fmt.Errorf("hacker not found")
	}
	
	return hacker, nil
}

// GetLeaderboard gets top hackers
func (s *Service) GetLeaderboard(limit int) []*Hacker {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	type sortable struct {
		hacker *Hacker
		reward float64
	}
	
	var list []sortable
	for _, h := range s.hackers {
		list = append(list, sortable{h, h.TotalReward})
	}
	
	// Sort descending
	for i := 0; i < len(list)-1; i++ {
		for j := i + 1; j < len(list); j++ {
			if list[j].reward > list[i].reward {
				list[i], list[j] = list[j], list[i]
			}
		}
	}
	
	result := make([]*Hacker, 0, limit)
	for i := 0; i < len(list) && i < limit; i++ {
		result = append(result, list[i].hacker)
	}
	
	return result
}

// GetRewards returns reward structure
func (s *Service) GetRewards() map[Severity]float64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	return s.rewards
}

// ============================================================================
// HELPER
// ============================================================================

func (s *Service) calculateReputation(severity Severity) float64 {
	switch severity {
	case SeverityCritical:
		return 100
	case SeverityHigh:
		return 50
	case SeverityMedium:
		return 25
	case SeverityLow:
		return 10
	default:
		return 5
	}
}

func hashReport(title, desc string) string {
	data := title + desc
	hash := sha256.Sum256([]byte(data))
	return hex.EncodeToString(hash[:])
}

// ============================================================================
// EXAMPLE
// ============================================================================

func main() {
	fmt.Println("TigerEx Bug Bounty Program v1.0.0")
	
	bb := NewService()
	
	// Register hacker
	hacker, _ := bb.RegisterHacker("security_expert", "hacker@example.com")
	
	fmt.Printf("Registered: %s\n", hacker.Username)
	
	// Submit bug report
	report, _ := bb.SubmitReport(
		hacker.ID,
		"SQL Injection in Login",
		"The login endpoint is vulnerable to SQL injection",
		"Authentication",
		"1. Go to /login\n2. Enter ' OR '1'='1 in username",
		"Full database compromise possible",
		SeverityCritical,
	)
	
	fmt.Printf("Report: %s - %s\n", report.ID, report.Title)
	
	// Triaging
	bb.Triage(report.ID, SeverityCritical)
	bb.Confirm(report.ID)
	
	// Fixing
	bb.Fix(report.ID, "Added parameterized queries")
	
	fmt.Printf("Reward: $%.2f\n", report.Reward)
	
	// Leaderboard
	leaders := bb.GetLeaderboard(10)
	fmt.Printf("Top hackers: %d\n", len(leaders))
}