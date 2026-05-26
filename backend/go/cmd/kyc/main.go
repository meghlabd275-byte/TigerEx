// Package KYC provides KYC Verification Service
package main

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"
)

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

type KYCLevel int
type KYCStatus int

const (
	KYCLevelBasic KYCLevel = 1
	KYCLevelIntermediate KYCLevel = 2
	KYCLevelFull KYCLevel = 3

	KYCStatusPending KYCStatus = iota
	KYCStatusInReview
	KYCStatusApproved
	KYCStatusRejected
	KYCStatusRequiresAction
)

// ============================================================================
// KYC APPLICATION
// ============================================================================

type KYCApplication struct {
	ID          string     `json:"id"`
	UserID     string     `json:"userId"`
	Level      KYCLevel   `json:"level"`
	Status     KYCStatus  `json:"status"`
	Documents  []Document `json:"documents"`
	VerifiedAt *time.Time `json:"verifiedAt,omitempty"`
	ExpiresAt  time.Time `json:"expiresAt"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type Document struct {
	Type        string `json:"type"` // passport, driver_license, national_id
	Number     string `json:"number"`
	ExpiryDate string `json:"expiryDate"`
	Status     string `json:"status"`
	VerifiedAt *time.Time `json:"verifiedAt,omitempty"`
}

// ============================================================================
// AML CHECK
// ============================================================================

type AMLCheck struct {
	ID          string   `json:"id"`
	UserID      string   `json:"userId"`
	PepStatus   bool     `json:"pepStatus"`    // Politically Exposed Person
	SdnStatus   bool     `json:"sdnStatus"`   // Sanctions list
	AdverseMedia bool   `json:"adverseMedia"` // Negative news
	HighRiskCountry bool `json:"highRiskCountry"`
	RiskScore   int     `json:"riskScore"`
	CheckedAt  time.Time `json:"checkedAt"`
}

// ============================================================================
// KYC SERVICE
// ============================================================================

type KYCService struct {
	mu          sync.RWMutex
	applications map[string]*KYCApplication
	amlChecks    map[string]*AMLCheck
	users        map[string]*KYCUser
	counter      uint64
}

type KYCUser struct {
	ID                string
	Tier             KYCLevel
	VerifiedAt       *time.Time
	Restrictions     []string
}

func NewKYCService() *KYCService {
	return &KYCService{
		applications: make(map[string]*KYCApplication),
		amlChecks:    make(map[string]*AMLCheck),
		users:        make(map[string]*KYCUser),
	}
}

// ============================================================================
// KYC OPERATIONS
// ============================================================================

func (ks *KYCService) SubmitApplication(userID string, level KYCLevel, docs []Document) (*KYCApplication, error) {
	ks.mu.Lock()
	defer ks.mu.Unlock()

	// Check existing application
	if app, exists := ks.applications[userID]; exists {
		if app.Status == KYCStatusPending || app.Status == KYCStatusInReview {
			return nil, fmt.Errorf("application already in progress")
		}
	}

	// Check tier
	if level <= ks.getUserLevel(userID) {
		return nil, fmt.Errorf("already verified at this level")
	}

	ks.counter++
	app := &KYCApplication{
		ID:          fmt.Sprintf("kyc_%d", ks.counter),
		UserID:      userID,
		Level:       level,
		Status:      KYCStatusPending,
		Documents:   docs,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
		ExpiresAt:   time.Now().Add(365 * 24 * time.Hour),
	}

	ks.applications[userID] = app
	ks.users[userID] = &KYCUser{ID: userID, Tier: level}

	return app, nil
}

func (ks *KYCService) getUserLevel(userID string) KYCLevel {
	if user, ok := ks.users[userID]; ok {
		return user.Tier
	}
	return 0
}

func (ks *KYCService) ReviewApplication(appID, reviewerID string, approved bool, notes string) error {
	ks.mu.Lock()
	defer ks.mu.Unlock()

	var app *KYCApplication
	for _, a := range ks.applications {
		if a.ID == appID {
			app = a
			break
		}
	}

	if app == nil {
		return fmt.Errorf("application not found")
	}

	if app.Status != KYCStatusPending && app.Status != KYCStatusInReview {
		return fmt.Errorf("application cannot be reviewed")
	}

	app.Status = KYCStatusInReview
	if approved {
		app.Status = KYCStatusApproved
		now := time.Now()
		app.VerifiedAt = &now
	} else {
		app.Status = KYCStatusRejected
	}
	app.UpdatedAt = time.Now()

	return nil
}

func (ks *KYCService) ApproveDocument(appID, docType string) error {
	ks.mu.Lock()
	defer ks.mu.Unlock()

	app, ok := ks.applications[appID]
	if !ok {
		return fmt.Errorf("application not found")
	}

	for i, doc := range app.Documents {
		if doc.Type == docType {
			app.Documents[i].Status = "verified"
			now := time.Now()
			app.Documents[i].VerifiedAt = &now
			app.UpdatedAt = time.Now()
			return nil
		}
	}

	return fmt.Errorf("document not found")
}

// ============================================================================
// AML OPERATIONS
// ============================================================================

func (ks *KYCService) PerformAMLChecks(userID string) *AMLCheck {
	ks.mu.Lock()
	defer ks.mu.Unlock()

	ks.counter++
	check := &AMLCheck{
		ID:               fmt.Sprintf("aml_%d", ks.counter),
		UserID:           userID,
		PepStatus:        false,  // Would check actual lists
		SdnStatus:       false,  // Would check OFAC, UN, etc
		AdverseMedia:     false,  // Would search news
		HighRiskCountry: false,  // Would check country
		RiskScore:        0,
		CheckedAt:        time.Now(),
	}

	// Calculate risk score
	if check.PepStatus {
		check.RiskScore += 50
	}
	if check.SdnStatus {
		check.RiskScore += 100
	}
	if check.AdverseMedia {
		check.RiskScore += 30
	}
	if check.HighRiskCountry {
		check.RiskScore += 40
	}

	ks.amlChecks[userID] = check
	return check
}

func (ks *KYCService) GetAMLCheck(userID string) *AMLCheck {
	ks.mu.RLock()
	defer ks.mu.RUnlock()
	return ks.amlChecks[userID]
}

func (ks *KYCService) BlockUser(userID, reason string) error {
	ks.mu.Lock()
	defer ks.mu.Unlock()

	if user, ok := ks.users[userID]; ok {
		user.Restrictions = append(user.Restrictions, reason)
	}
	return nil
}

// ============================================================================
// QUERIES
// ============================================================================

func (ks *KYCService) GetUserKYC(userID string) (*KYCApplication, *AMLCheck) {
	ks.mu.RLock()
	defer ks.mu.RUnlock()

	return ks.applications[userID], ks.amlChecks[userID]
}

func (ks *KYCService) GetPendingApplications() []*KYCApplication {
	ks.mu.RLock()
	defer ks.mu.RUnlock()

	var result []*KYCApplication
	for _, app := range ks.applications {
		if app.Status == KYCStatusPending || app.Status == KYCStatusInReview {
			result = append(result, app)
		}
	}
	return result
}

func (ks *KYCService) GetStats() map[string]interface{} {
	ks.mu.RLock()
	defer ks.mu.RUnlock()

	pending := 0
	approved := 0
	rejected := 0

	for _, app := range ks.applications {
		switch app.Status {
		case KYCStatusPending, KYCStatusInReview:
			pending++
		case KYCStatusApproved:
			approved++
		case KYCStatusRejected:
			rejected++
		}
	}

	return map[string]interface{}{
		"total_applications": len(ks.applications),
		"pending":           pending,
		"approved":         approved,
		"rejected":         rejected,
	}
}

// ============================================================================
// MAIN
// ============================================================================

func main() {
	ks := NewKYCService()

	docs := []Document{
		{Type: "passport", Number: "AB123456", ExpiryDate: "2028-12-31"},
	}

	app, _ := ks.SubmitApplication("user123", KYCLevelBasic, docs)
	fmt.Printf("Submitted KYC: %s\n", app.ID)

	// AML check
	aml := ks.PerformAMLChecks("user123")
	fmt.Printf("AML Score: %d\n", aml.RiskScore)

	// Review
	ks.ReviewApplication(app.ID, "admin1", true, "")
	fmt.Printf("Application status: approved\n")

	// Stats
	fmt.Printf("Stats: %v\n", ks.GetStats())
}