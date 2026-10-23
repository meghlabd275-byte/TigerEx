package kyc

import (
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"tigerex/backend/internal/security"
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
	GetSecurityContext(r *http.Request) *security.SecurityContext
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
	// Check if user already has pending application
	for _, app := range s.applications {
		if app.UserID == userID && app.Status == StatusPending {
			s.mu.Unlock()
			return nil, fmt.Errorf("pending application already exists")
		}
	}

	application := &KYCApplication{
		ApplicationID: generateApplicationID(),
		UserID:        userID,
		Level:         1,
		Status:        StatusPending,
		DocumentType:   documentType,
		DocumentID:     documentID,
		LivenessResult: LivenessPending,
		SubmittedAt:    time.Now(),
	}

	s.applications[application.ApplicationID] = application
	s.mu.Unlock()

	s.processDocument(application)

	return application, nil
}

func (s *KYCService) SubmitSelfie(userID, selfieURL string) error {
	s.mu.Lock()

	// An application may already be under review, so accept both pending
	// and reviewing states.
	var application *KYCApplication
	for _, app := range s.applications {
		if app.UserID == userID && (app.Status == StatusPending || app.Status == StatusReviewing) {
			application = app
			break
		}
	}

	if application == nil {
		s.mu.Unlock()
		return fmt.Errorf("no pending application found")
	}

	application.SelfieURL = selfieURL
	s.mu.Unlock()

	if s.config.EnableLivenessCheck {
		s.processLiveness(application)
	}

	return nil
}

func (s *KYCService) SubmitVideoKYC(userID, videoURL string) error {
	if !s.config.EnableVideoKYC {
		return fmt.Errorf("video KYC not enabled")
	}

	s.mu.Lock()

	var application *KYCApplication
	for _, app := range s.applications {
		if app.UserID == userID && (app.Status == StatusPending || app.Status == StatusReviewing) {
			application = app
			break
		}
	}

	if application == nil {
		s.mu.Unlock()
		return fmt.Errorf("no pending application found")
	}
	s.mu.Unlock()

	s.processVideoKYC(application)

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

// processDocument moves an application into manual review. No automated
// document-verification service is wired in this build, so the application
// is queued for a human reviewer rather than being auto-approved.
func (s *KYCService) processDocument(application *KYCApplication) {
	s.mu.Lock()
	defer s.mu.Unlock()

	application.Status = StatusReviewing
	log.Printf("KYC: application %s queued for manual document review", application.ApplicationID)
}

// processLiveness records that a selfie is awaiting review. No liveness
// detection model is wired in this build, so the result stays pending and a
// reviewer decides the outcome.
func (s *KYCService) processLiveness(application *KYCApplication) {
	s.mu.Lock()
	defer s.mu.Unlock()

	application.LivenessResult = LivenessPending
	log.Printf("KYC: liveness for application %s requires manual review", application.ApplicationID)
}

// processVideoKYC queues a video session for manual review.
func (s *KYCService) processVideoKYC(application *KYCApplication) {
	s.mu.Lock()
	defer s.mu.Unlock()

	application.Status = StatusReviewing
	log.Printf("KYC: video session for application %s queued for manual review", application.ApplicationID)
}

func generateApplicationID() string {
	return fmt.Sprintf("KYC-%d", time.Now().UnixNano())
}