package kyc

import (
	"fmt"
	"log"
	"sync"
	"time"
)

type KYCService struct {
	config KYCConfig
	security SecurityLayer
	mu sync.RWMutex
	applications map[string]*KYCApplication
}

type KYCConfig struct {
	EnableKYC           bool
	RequireKYCWithdraw bool
	EnableLivenessCheck bool
	EnableVideoKYC     bool
	AMLEnabled         bool
}

type SecurityLayer interface {
	GetSecurityContext(r interface{}) interface{}
}

type KYCApplication struct {
	ApplicationID  string
	UserID         string
	Level          int
	Status         KYCStatus
	DocumentType   string
	DocumentID     string
	SelfieURL      string
	LivenessResult LivenessStatus
	SubmittedAt    time.Time
	ReviewedAt     *time.Time
	ReviewerID    string
	Reason        string
}

type KYCStatus string
type LivenessStatus string

const (
	StatusPending   KYCStatus = "pending"
	StatusReviewing KYCStatus = "reviewing"
	StatusApproved  KYCStatus = "approved"
	StatusRejected KYCStatus = "rejected"
	StatusExpired  KYCStatus = "expired"

	LivenessPending  LivenessStatus = "pending"
	LivenessPassed  LivenessStatus = "passed"
	LivenessFailed  LivenessStatus = "failed"
)

func NewKYCService(config KYCConfig, security SecurityLayer) *KYCService {
	return &KYCService{
		config:        config,
		security:     security,
		applications: make(map[string]*KYCApplication),
	}
}

func (s *KYCService) SubmitApplication(userID, documentType, documentID string) (*KYCApplication, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Check if user already has pending application
	for _, app := range s.applications {
		if app.UserID == userID && app.Status == StatusPending {
			return nil, fmt.Errorf("pending application already exists")
		}
	}

	application := &KYCApplication{
		ApplicationID: generateApplicationID(),
		UserID:        userID,
		Level:         1,
		Status:        StatusPending,
		DocumentType:  documentType,
		DocumentID:    documentID,
		SubmittedAt:   time.Now(),
	}

	s.applications[application.ApplicationID] = application

	// Process document verification
	go s.processDocument(application)

	return application, nil
}

func (s *KYCService) SubmitSelfie(userID, selfieURL string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Find user's application
	var application *KYCApplication
	for _, app := range s.applications {
		if app.UserID == userID && app.Status == StatusPending {
			application = app
			break
		}
	}

	if application == nil {
		return fmt.Errorf("no pending application found")
	}

	application.SelfieURL = selfieURL

	// Process liveness check
	if s.config.EnableLivenessCheck {
		go s.processLiveness(application)
	}

	return nil
}

func (s *KYCService) SubmitVideoKYC(userID, videoURL string) error {
	if !s.config.EnableVideoKYC {
		return fmt.Errorf("video KYC not enabled")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	var application *KYCApplication
	for _, app := range s.applications {
		if app.UserID == userID && app.Status == StatusPending {
			application = app
			break
		}
	}

	if application == nil {
		return fmt.Errorf("no pending application found")
	}

	// Process video verification
	go s.processVideoKYC(application)

	return nil
}

func (s *KYCService) GetApplication(userID string) (*KYCApplication, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, app := range s.applications {
		if app.UserID == userID {
			return app, nil
		}
	}

	return nil, fmt.Errorf("application not found")
}

func (s *KYCService) GetStatus(userID string) (KYCStatus, int, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, app := range s.applications {
		if app.UserID == userID {
			return app.Status, app.Level, nil
		}
	}

	return "", 0, fmt.Errorf("application not found")
}

func (s *KYCService) ReviewApplication(applicationID, reviewerID, reason string, approved bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	application, exists := s.applications[applicationID]
	if !exists {
		return fmt.Errorf("application not found")
	}

	now := time.Now()
	application.ReviewedAt = &now
	application.ReviewerID = reviewerID
	application.Reason = reason

	if approved {
		application.Status = StatusApproved
		application.Level = 2
	} else {
		application.Status = StatusRejected
	}

	return nil
}

func (s *KYCService) processDocument(application *KYCApplication) {
	// Simulate document verification
	time.Sleep(2 * time.Second)

	// In production, integrate with document verification service
	// Verify document authenticity, extract data, check for fraud

	s.mu.Lock()
	defer s.mu.Unlock()

	application.Status = StatusReviewing
	log.Printf("KYC: Document verification started for application %s", application.ApplicationID)
}

func (s *KYCService) processLiveness(application *KYCApplication) {
	// Simulate liveness check
	time.Sleep(1 * time.Second)

	s.mu.Lock()
	defer s.mu.Unlock()

	// In production, use ML model for liveness detection
	application.LivenessResult = LivenessPassed
	log.Printf("KYC: Liveness check completed for application %s", application.ApplicationID)
}

func (s *KYCService) processVideoKYC(application *KYCApplication) {
	// Simulate video KYC verification
	time.Sleep(3 * time.Second)

	s.mu.Lock()
	defer s.mu.Unlock()

	application.Status = StatusReviewing
	log.Printf("KYC: Video verification started for application %s", application.ApplicationID)
}

func generateApplicationID() string {
	return fmt.Sprintf("KYC-%d", time.Now().UnixNano())
}