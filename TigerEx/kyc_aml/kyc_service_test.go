package kycaml

import (
	"context"
	"errors"
	"testing"
	"time"
)

// fakeVerifier is a scripted IdentityVerifier for exercising the service.
// It is a deliberate test double: the real integration is a vendor SDK.
type fakeVerifier struct {
	docVerified  bool
	faceVerified bool
	docScore     float64
	err          error
}

func (f *fakeVerifier) VerifyDocument(_ context.Context, _ *KYCRecord) (bool, float64, error) {
	if f.err != nil {
		return false, 0, f.err
	}
	return f.docVerified, f.docScore, nil
}

func (f *fakeVerifier) VerifyFace(_ context.Context, _ *KYCRecord) (bool, float64, error) {
	if f.err != nil {
		return false, 0, f.err
	}
	return f.faceVerified, f.docScore, nil
}

// fakeScreener is a scripted AMLScreener.
type fakeScreener struct {
	result *AMLScreenResult
	err    error
}

func (f *fakeScreener) Screen(_ context.Context, _, _ string) (*AMLScreenResult, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.result, nil
}

func submitAndWait(t *testing.T, svc *KYCService, userID string) *KYCRecord {
	t.Helper()
	_, err := svc.SubmitKYC(userID, &KYCRecord{
		FirstName:      "Test",
		LastName:       "User",
		DateOfBirth:    "1990-01-01",
		Nationality:    "US",
		DocumentType:   "passport",
		DocumentNumber: "X1234567",
	})
	if err != nil {
		t.Fatalf("SubmitKYC failed: %v", err)
	}

	// verifyKYCAsync runs in a goroutine; wait for it to settle.
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		got, err := svc.GetKYC(userID)
		if err == nil && got.Status != KYCStatusPending {
			return got
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("KYC verification did not settle")
	return nil
}

// With no verifier configured, a submission must not be approved.
func TestKYCWithoutVerifierIsNotApproved(t *testing.T) {
	svc := NewKYCService()
	svc.config.AutoApproveEnabled = true

	record := submitAndWait(t, svc, "user-no-verifier")

	if record.Status == KYCStatusApproved {
		t.Fatal("KYC must not be approved without a verifier")
	}
	if record.DocumentVerified || record.FaceVerified {
		t.Fatal("verification flags must not be set without a verifier")
	}
	if record.Status != KYCStatusInReview {
		t.Fatalf("expected in_review, got %q", record.Status)
	}
}

// A failing verifier must not be approved.
func TestKYCFailedVerificationIsNotApproved(t *testing.T) {
	svc := NewKYCService()
	svc.config.AutoApproveEnabled = true
	svc.config.Verifier = &fakeVerifier{docVerified: true, faceVerified: true, err: errors.New("provider down")}

	record := submitAndWait(t, svc, "user-verifier-error")

	if record.Status == KYCStatusApproved {
		t.Fatal("KYC must not be approved when the verifier errors")
	}
	if record.DocumentVerified || record.FaceVerified {
		t.Fatal("verification flags must not be set when the verifier errors")
	}
}

// A verifier that reports a failure must not lead to approval.
func TestKYCFailedDocumentIsNotApproved(t *testing.T) {
	svc := NewKYCService()
	svc.config.AutoApproveEnabled = true
	svc.config.Verifier = &fakeVerifier{docVerified: false, faceVerified: true, docScore: 90}

	record := submitAndWait(t, svc, "user-doc-fail")

	if record.Status == KYCStatusApproved {
		t.Fatal("KYC must not be approved when the document fails")
	}
}

// A passing verifier with auto-approve off must go to review, not approval.
func TestKYCPassingVerifierGoesToReviewWhenAutoApproveOff(t *testing.T) {
	svc := NewKYCService()
	svc.config.AutoApproveEnabled = false
	svc.config.Verifier = &fakeVerifier{docVerified: true, faceVerified: true, docScore: 95}

	record := submitAndWait(t, svc, "user-manual-review")

	if record.Status != KYCStatusInReview {
		t.Fatalf("expected in_review, got %q", record.Status)
	}
}

// A passing verifier with auto-approve on may approve.
func TestKYCPassingVerifierApprovesWhenAutoApproveOn(t *testing.T) {
	svc := NewKYCService()
	svc.config.AutoApproveEnabled = true
	svc.config.Verifier = &fakeVerifier{docVerified: true, faceVerified: true, docScore: 95}

	record := submitAndWait(t, svc, "user-approved")

	if record.Status != KYCStatusApproved {
		t.Fatalf("expected approved, got %q", record.Status)
	}
	if !record.DocumentVerified || !record.FaceVerified {
		t.Fatal("verification flags must be set on approval")
	}
}

// Screening with no screener must be reported as UNSCREENED, not clean.
func TestAMLScreenWithoutScreenerIsNotClean(t *testing.T) {
	svc := NewKYCService()
	svc.config.Verifier = &fakeVerifier{docVerified: true, faceVerified: true, docScore: 95}
	submitAndWait(t, svc, "user-aml-none")

	result, err := svc.RunAMLScreen("user-aml-none")
	if err != nil {
		t.Fatalf("RunAMLScreen failed: %v", err)
	}
	if result.Status != "UNSCREENED" {
		t.Fatalf("expected UNSCREENED, got %q", result.Status)
	}
	if result.RiskLevel != "high" {
		t.Fatalf("an unscreened user must be high risk, got %q", result.RiskLevel)
	}
}

// A screening error must not be reported as clean.
func TestAMLScreenErrorIsNotClean(t *testing.T) {
	svc := NewKYCService()
	svc.config.Screener = &fakeScreener{err: errors.New("list provider down")}
	svc.config.Verifier = &fakeVerifier{docVerified: true, faceVerified: true, docScore: 95}
	submitAndWait(t, svc, "user-aml-err")

	result, err := svc.RunAMLScreen("user-aml-err")
	if err != nil {
		t.Fatalf("RunAMLScreen failed: %v", err)
	}
	if result.Status != "ERROR" {
		t.Fatalf("expected ERROR, got %q", result.Status)
	}
	if result.MatchFound {
		t.Fatal("a failed screen must not report a match")
	}
	if result.RiskLevel != "high" {
		t.Fatalf("a failed screen must be high risk, got %q", result.RiskLevel)
	}
}

// A real sanctions hit must be surfaced.
func TestAMLScreenSanctionsHit(t *testing.T) {
	svc := NewKYCService()
	svc.config.Screener = &fakeScreener{result: &AMLScreenResult{
		Sanctions:    true,
		Score:        95,
		MatchDetails: "OFAC SDN match",
	}}
	svc.config.Verifier = &fakeVerifier{docVerified: true, faceVerified: true, docScore: 95}
	submitAndWait(t, svc, "user-sanctioned")

	result, err := svc.RunAMLScreen("user-sanctioned")
	if err != nil {
		t.Fatalf("RunAMLScreen failed: %v", err)
	}
	if !result.MatchFound {
		t.Fatal("a sanctions hit must set MatchFound")
	}
	if result.MatchType != "sanctions" {
		t.Fatalf("expected sanctions match type, got %q", result.MatchType)
	}
	if result.RiskLevel != "high" {
		t.Fatalf("a sanctions hit must be high risk, got %q", result.RiskLevel)
	}
}

// A clean screen with no hits must be low risk.
func TestAMLScreenCleanResult(t *testing.T) {
	svc := NewKYCService()
	svc.config.Screener = &fakeScreener{result: &AMLScreenResult{Score: 5}}
	svc.config.Verifier = &fakeVerifier{docVerified: true, faceVerified: true, docScore: 95}
	submitAndWait(t, svc, "user-clean")

	result, err := svc.RunAMLScreen("user-clean")
	if err != nil {
		t.Fatalf("RunAMLScreen failed: %v", err)
	}
	if result.MatchFound {
		t.Fatal("a clean screen must not report a match")
	}
	if result.Status != "completed" {
		t.Fatalf("expected completed, got %q", result.Status)
	}
}

// The Travel Rule threshold must be recorded on the report.
func TestProcessTravelRuleThreshold(t *testing.T) {
	svc := NewKYCService()

	small := &TravelRule{Amount: 500, Currency: "USD"}
	if err := svc.ProcessTravelRule(small); err != nil {
		t.Fatalf("ProcessTravelRule failed: %v", err)
	}
	if small.TravelRuleRequired {
		t.Fatal("a transfer below the threshold must not require the travel rule")
	}

	large := &TravelRule{Amount: 5000, Currency: "USD"}
	if err := svc.ProcessTravelRule(large); err != nil {
		t.Fatalf("ProcessTravelRule failed: %v", err)
	}
	if !large.TravelRuleRequired {
		t.Fatal("a transfer at or above the threshold must require the travel rule")
	}
}
