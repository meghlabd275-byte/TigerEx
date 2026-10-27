package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// Verification is the pluggable identity-verification backend.
//
// The KYC service must never assert that a document, selfie, liveness check, or
// AML screening passed unless something actually checked it. The previous code
// hardcoded those results. Each method here returns a measured outcome; an
// error means the check could not be performed and the caller must fail closed.

var (
	errNotFound     = errors.New("not found")
	errLookupFailed = errors.New("lookup failed")
	errForbidden    = errors.New("forbidden")
)

// Scores at or above these thresholds count as a pass.
const (
	minDocumentScore    = 0.80
	minSelfieMatchScore = 0.80
)

// DocumentCheck is the input to a document verification.
type DocumentCheck struct {
	ApplicationID  string
	DocumentType   string
	Side           string
	FilePath       string
	FileHash       string
	DocumentNumber string
}

// SelfieCheck is the input to a selfie/face-match verification.
type SelfieCheck struct {
	ApplicationID string
	FilePath      string
	FileHash      string
}

// LivenessCheck is the input to a liveness verification.
type LivenessCheck struct {
	ApplicationID string
	Challenge     string
}

// AMLScreenRequest is the input to a sanctions/PEP screening.
type AMLScreenRequest struct {
	ApplicationID string
	FirstName     string
	LastName      string
	Nationality   string
	Country       string
}

// AMLScreenResult is the outcome of a screening.
type AMLScreenResult struct {
	Result         string
	RiskScore      int
	PEPStatus      bool
	SanctionStatus bool
	AdverseMedia   bool
	Countries      []string
	Watchlists     []string
}

// Verifier performs the identity checks the KYC service depends on.
type Verifier interface {
	VerifyDocument(ctx context.Context, in DocumentCheck) (score float64, err error)
	MatchSelfie(ctx context.Context, in SelfieCheck) (score float64, err error)
	CheckLiveness(ctx context.Context, in LivenessCheck) (passed bool, err error)
	ScreenAML(ctx context.Context, in AMLScreenRequest) (*AMLScreenResult, error)
}

// HTTPVerifier calls an external verification service over HTTP. The service is
// the operator's own KYC/AML provider (for example an OCR and liveness model
// deployment, or a sanctions list service); it is not a third-party exchange.
type HTTPVerifier struct {
	baseURL string
	client  *http.Client
}

// NewHTTPVerifier creates a verifier pointed at baseURL.
func NewHTTPVerifier(baseURL string) *HTTPVerifier {
	return &HTTPVerifier{
		baseURL: baseURL,
		client:  &http.Client{Timeout: 30 * time.Second},
	}
}

// post sends payload and decodes the response into out.
func (h *HTTPVerifier) post(ctx context.Context, path string, payload, out interface{}) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, h.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := h.client.Do(req)
	if err != nil {
		return fmt.Errorf("verifier request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("verifier returned %d: %s", resp.StatusCode, string(msg))
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// VerifyDocument returns the verification score for a document.
func (h *HTTPVerifier) VerifyDocument(ctx context.Context, in DocumentCheck) (float64, error) {
	var resp struct {
		Score float64 `json:"score"`
	}
	err := h.post(ctx, "/v1/document", map[string]interface{}{
		"application_id":  in.ApplicationID,
		"document_type":   in.DocumentType,
		"side":            in.Side,
		"file_path":       in.FilePath,
		"file_hash":       in.FileHash,
		"document_number": in.DocumentNumber,
	}, &resp)
	if err != nil {
		return 0, err
	}
	if resp.Score < 0 || resp.Score > 1 {
		return 0, fmt.Errorf("verifier returned an out-of-range score %v", resp.Score)
	}
	return resp.Score, nil
}

// MatchSelfie returns the face-match score for a selfie.
func (h *HTTPVerifier) MatchSelfie(ctx context.Context, in SelfieCheck) (float64, error) {
	var resp struct {
		Score float64 `json:"score"`
	}
	err := h.post(ctx, "/v1/selfie", map[string]interface{}{
		"application_id": in.ApplicationID,
		"file_path":      in.FilePath,
		"file_hash":      in.FileHash,
	}, &resp)
	if err != nil {
		return 0, err
	}
	if resp.Score < 0 || resp.Score > 1 {
		return 0, fmt.Errorf("verifier returned an out-of-range score %v", resp.Score)
	}
	return resp.Score, nil
}

// CheckLiveness returns whether the challenge-response liveness check passed.
func (h *HTTPVerifier) CheckLiveness(ctx context.Context, in LivenessCheck) (bool, error) {
	var resp struct {
		Passed bool `json:"passed"`
	}
	err := h.post(ctx, "/v1/liveness", map[string]interface{}{
		"application_id": in.ApplicationID,
		"challenge":      in.Challenge,
	}, &resp)
	if err != nil {
		return false, err
	}
	return resp.Passed, nil
}

// ScreenAML returns the sanctions/PEP screening result.
func (h *HTTPVerifier) ScreenAML(ctx context.Context, in AMLScreenRequest) (*AMLScreenResult, error) {
	var resp struct {
		Result         string   `json:"result"`
		RiskScore      int      `json:"risk_score"`
		PEPStatus      bool     `json:"pep_status"`
		SanctionStatus bool     `json:"sanction_status"`
		AdverseMedia   bool     `json:"adverse_media"`
		Countries      []string `json:"countries"`
		Watchlists     []string `json:"watchlists"`
	}
	err := h.post(ctx, "/v1/aml", map[string]interface{}{
		"application_id": in.ApplicationID,
		"first_name":     in.FirstName,
		"last_name":      in.LastName,
		"nationality":    in.Nationality,
		"country":        in.Country,
	}, &resp)
	if err != nil {
		return nil, err
	}

	switch resp.Result {
	case "clear", "review", "blocked":
	default:
		return nil, fmt.Errorf("verifier returned an unknown AML result %q", resp.Result)
	}
	if resp.RiskScore < 0 || resp.RiskScore > 100 {
		return nil, fmt.Errorf("verifier returned an out-of-range risk score %d", resp.RiskScore)
	}

	return &AMLScreenResult{
		Result:         resp.Result,
		RiskScore:      resp.RiskScore,
		PEPStatus:      resp.PEPStatus,
		SanctionStatus: resp.SanctionStatus,
		AdverseMedia:   resp.AdverseMedia,
		Countries:      resp.Countries,
		Watchlists:     resp.Watchlists,
	}, nil
}

// writeErrorForAccess maps an access error to an HTTP response.
func writeErrorForAccess(c *gin.Context, err error) {
	switch {
	case errors.Is(err, errForbidden):
		writeError(c, 403, "Forbidden")
	case errors.Is(err, errNotFound):
		writeError(c, 404, "Application not found")
	default:
		writeError(c, 500, "Database error")
	}
}
