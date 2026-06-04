package kyc

import (
    "errors"
    "time"
    "sync"
    "crypto/rand"
    "encoding/base64"
)

var (
    ErrInvalidDocument   = errors.New("invalid document")
    ErrVerificationFailed = errors.New("verification failed")
    ErrUserNotEligible  = errors.New("user not eligible for KYC")
    ErrAlreadyVerified  = errors.New("user already verified")
)

type KYCLevel int

const (
    KYCLevelNone KYCLevel = 0
    KYCLevelBasic KYCLevel = 1
    KYCLevelIntermediate KYCLevel = 2
    KYCLevelAdvanced KYCLevel = 3
)

type VerificationStatus string

const (
    StatusPending    VerificationStatus = "pending"
    StatusSubmitted  VerificationStatus = "submitted"
    StatusProcessing VerificationStatus = "processing"
    StatusApproved   VerificationStatus = "approved"
    StatusRejected   VerificationStatus = "rejected"
)

type DocumentType string

const (
    DocPassport      DocumentType = "passport"
    DocNationalID    DocumentType = "national_id"
    DocDriversLicense DocumentType = "drivers_license"
    DocProofOfAddress DocumentType = "proof_of_address"
    DocSelfie        DocumentType = "selfie"
)

type KYCUser struct {
    ID                string             `json:"id"`
    UserID            string             `json:"user_id"`
    Level             KYCLevel           `json:"kyc_level"`
    Status            VerificationStatus `json:"status"`
    Documents         []*KYCDocument     `json:"documents"`
    RejectionReason   string             `json:"rejection_reason,omitempty"`
    ReviewedBy       string             `json:"reviewed_by,omitempty"`
    ReviewedAt        *time.Time         `json:"reviewed_at,omitempty"`
    CreatedAt         time.Time          `json:"created_at"`
    UpdatedAt         time.Time          `json:"updated_at"`
}

type KYCDocument struct {
    ID              string        `json:"id"`
    UserID          string        `json:"user_id"`
    DocumentType    DocumentType  `json:"document_type"`
    DocumentNumber  string        `json:"document_number"`
    IssuingCountry  string        `json:"issuing_country"`
    FileURLs        []string      `json:"file_urls"`
    ExtractedData   map[string]interface{} `json:"extracted_data"`
    Status          VerificationStatus `json:"status"`
    RejectionReason string        `json:"rejection_reason,omitempty"`
    VerifiedAt      *time.Time    `json:"verified_at,omitempty"`
    ExpiresAt       *time.Time    `json:"expires_at,omitempty"`
    CreatedAt       time.Time     `json:"created_at"`
}

type AMLCheck struct {
    ID         string                 `json:"id"`
    UserID     string                 `json:"user_id"`
    CheckType  string                 `json:"check_type"`
    Status     VerificationStatus     `json:"status"`
    ResultData map[string]interface{} `json:"result_data"`
    RiskScore  int                   `json:"risk_score"`
    CreatedAt  time.Time              `json:"created_at"`
}

type KYCService struct {
    mu    sync.RWMutex
    users map[string]*KYCUser
}

func NewKYCService() *KYCService {
    return &KYCService{
        users: make(map[string]*KYCUser),
    }
}

func (s *KYCService) StartKYC(userID string) (*KYCUser, error) {
    s.mu.Lock()
    defer s.mu.Unlock()
    
    kycUser := &KYCUser{
        ID:        generateID(),
        UserID:    userID,
        Level:     KYCLevelNone,
        Status:    StatusPending,
        Documents: make([]*KYCDocument, 0),
        CreatedAt: time.Now(),
        UpdatedAt: time.Now(),
    }
    s.users[userID] = kycUser
    return kycUser, nil
}

func (s *KYCService) SubmitDocument(userID string, doc *KYCDocument) error {
    s.mu.Lock()
    defer s.mu.Unlock()
    
    kycUser, exists := s.users[userID]
    if !exists {
        return errors.New("KYC not started")
    }
    
    if kycUser.Status == StatusApproved {
        return ErrAlreadyVerified
    }
    
    doc.ID = generateID()
    doc.UserID = userID
    doc.Status = StatusSubmitted
    doc.CreatedAt = time.Now()
    
    kycUser.Documents = append(kycUser.Documents, doc)
    kycUser.Status = StatusSubmitted
    kycUser.UpdatedAt = time.Now()
    
    return nil
}

func (s *KYCService) ProcessKYC(userID string, reviewerID string) error {
    s.mu.Lock()
    defer s.mu.Unlock()
    
    kycUser, exists := s.users[userID]
    if !exists {
        return errors.New("KYC not found")
    }
    
    if len(kycUser.Documents) == 0 {
        kycUser.Status = StatusRejected
        kycUser.RejectionReason = "No documents submitted"
        return nil
    }
    
    allValid := true
    for _, doc := range kycUser.Documents {
        if doc.Status != StatusApproved {
            allValid = false
            break
        }
    }
    
    if allValid && len(kycUser.Documents) >= 2 {
        kycUser.Status = StatusApproved
        kycUser.Level = KYCLevelIntermediate
        now := time.Now()
        kycUser.ReviewedAt = &now
        kycUser.ReviewedBy = reviewerID
    } else {
        kycUser.Status = StatusProcessing
    }
    
    kycUser.UpdatedAt = time.Now()
    return nil
}

func (s *KYCService) ApproveDocument(docID, reviewerID string) error {
    s.mu.Lock()
    defer s.mu.Unlock()
    
    for _, kycUser := range s.users {
        for _, doc := range kycUser.Documents {
            if doc.ID == docID {
                doc.Status = StatusApproved
                now := time.Now()
                doc.VerifiedAt = &now
                return nil
            }
        }
    }
    return errors.New("document not found")
}

func (s *KYCService) RejectDocument(docID, reviewerID, reason string) error {
    s.mu.Lock()
    defer s.mu.Unlock()
    
    for _, kycUser := range s.users {
        for _, doc := range kycUser.Documents {
            if doc.ID == docID {
                doc.Status = StatusRejected
                doc.RejectionReason = reason
                return nil
            }
        }
    }
    return errors.New("document not found")
}

func (s *KYCService) PerformAMLCheck(userID string) (*AMLCheck, error) {
    s.mu.Lock()
    defer s.mu.Unlock()
    
    check := &AMLCheck{
        ID:        generateID(),
        UserID:    userID,
        CheckType: "aml_screening",
        Status:    StatusPending,
        RiskScore: 0,
        CreatedAt: time.Now(),
    }
    
    check.ResultData = map[string]interface{}{
        "sanctions_match":    false,
        "pep_match":          false,
        "adverse_media":      false,
        "approved":           true,
    }
    
    check.Status = StatusApproved
    
    return check, nil
}

func (s *KYCService) GetKYCStatus(userID string) (*KYCUser, error) {
    s.mu.RLock()
    defer s.mu.RUnlock()
    
    kycUser, exists := s.users[userID]
    if !exists {
        return nil, errors.New("KYC not found")
    }
    return kycUser, nil
}

func (s *KYCService) GetRequiredDocuments(level KYCLevel) []DocumentType {
    switch level {
    case KYCLevelBasic:
        return []DocumentType{DocNationalID}
    case KYCLevelIntermediate:
        return []DocumentType{DocPassport, DocProofOfAddress}
    case KYCLevelAdvanced:
        return []DocumentType{DocPassport, DocProofOfAddress, DocSelfie}
    default:
        return []DocumentType{}
    }
}

func (s *KYCService) CanWithdraw(userID string, amount float64) (bool, string) {
    s.mu.RLock()
    defer s.mu.RUnlock()
    
    kycUser, exists := s.users[userID]
    if !exists {
        return false, "KYC not completed"
    }
    
    if kycUser.Status != StatusApproved {
        return false, "KYC not approved"
    }
    
    switch {
    case amount > 10000 && kycUser.Level < KYCLevelIntermediate:
        return false, "Intermediate KYC required for withdrawals over $10,000"
    case amount > 100000 && kycUser.Level < KYCLevelAdvanced:
        return false, "Advanced KYC required for withdrawals over $100,000"
    }
    
    return true, ""
}

func generateID() string {
    b := make([]byte, 16)
    rand.Read(b)
    return base64.URLEncoding.EncodeToString(b)
}