package kyc_aml

import (
	"errors"
	"testing"
)

type stubVerifier struct {
	docOK  bool
	liveOK bool
	err    error
	calls  int
}

func (v *stubVerifier) VerifyDocument(_ *IdentityDocument, _ *KYCProfile) (bool, bool, error) {
	v.calls++
	return v.docOK, v.liveOK, v.err
}

type stubScreener struct {
	status   string
	severity string
	err      error
}

func (s *stubScreener) Screen(_, _ string) (string, string, string, error) {
	if s.err != nil {
		return "", "", "", s.err
	}
	return s.status, s.severity, "", nil
}

func newProfile(t *testing.T) *KYCService {
	t.Helper()
	svc := NewKYCService()
	if _, err := svc.InitiateKYC("u1", "Ada", "Lovelace", "1815-12-10", "GB", "GB"); err != nil {
		t.Fatalf("InitiateKYC: %v", err)
	}
	if err := svc.SubmitDocument("u1", &IdentityDocument{Type: DocumentTypePassport, Number: "X123"}); err != nil {
		t.Fatalf("SubmitDocument: %v", err)
	}
	return svc
}

func TestVerifyDocumentWithoutVerifierIsNotApproved(t *testing.T) {
	svc := newProfile(t)
	if err := svc.VerifyDocument("u1"); err == nil {
		t.Fatal("expected an error when no verifier is configured")
	}
	profile, _ := svc.GetKYCProfile("u1")
	if profile.Status == VerificationStatusApproved {
		t.Fatal("profile must not be approved without a verifier")
	}
}

func TestVerifyDocumentFailsClosedOnVerifierError(t *testing.T) {
	svc := newProfile(t)
	svc.SetVerifier(&stubVerifier{err: errors.New("provider down")})
	if err := svc.VerifyDocument("u1"); err == nil {
		t.Fatal("expected an error when the verifier fails")
	}
	profile, _ := svc.GetKYCProfile("u1")
	if profile.Status == VerificationStatusApproved {
		t.Fatal("profile must not be approved when the verifier errors")
	}
}

func TestVerifyDocumentRejectsFailedLiveness(t *testing.T) {
	svc := newProfile(t)
	svc.SetVerifier(&stubVerifier{docOK: true, liveOK: false})
	if err := svc.VerifyDocument("u1"); err == nil {
		t.Fatal("expected an error when liveness fails")
	}
	profile, _ := svc.GetKYCProfile("u1")
	if profile.Status != VerificationStatusRejected {
		t.Fatalf("expected REJECTED, got %s", profile.Status)
	}
}

func TestVerifyDocumentApprovesOnPassingVerifier(t *testing.T) {
	svc := newProfile(t)
	svc.SetVerifier(&stubVerifier{docOK: true, liveOK: true})
	if err := svc.VerifyDocument("u1"); err != nil {
		t.Fatalf("VerifyDocument: %v", err)
	}
	profile, _ := svc.GetKYCProfile("u1")
	if profile.Status != VerificationStatusApproved {
		t.Fatalf("expected APPROVED, got %s", profile.Status)
	}
	if profile.Level != KYCLevelStandard {
		t.Fatalf("expected STANDARD level, got %s", profile.Level)
	}
}

func TestAMLScreeningWithoutScreenerIsPendingNotPass(t *testing.T) {
	svc := NewKYCService()
	if _, err := svc.InitiateKYC("u2", "Alan", "Turing", "1912-06-23", "GB", "GB"); err != nil {
		t.Fatalf("InitiateKYC: %v", err)
	}
	checks := svc.GetAMLCheck("u2")
	if len(checks) == 0 {
		t.Fatal("expected AML checks to be recorded")
	}
	for _, c := range checks {
		if c.Status == "PASS" {
			t.Fatalf("check %s must not be a fabricated PASS without a screener", c.CheckType)
		}
		if c.Status != "PENDING" {
			t.Fatalf("expected PENDING, got %s", c.Status)
		}
	}
}

func TestAMLScreeningRecordsRealOutcome(t *testing.T) {
	svc := NewKYCService()
	svc.SetScreener(&stubScreener{status: "FAIL", severity: "HIGH"})
	if _, err := svc.InitiateKYC("u3", "Grace", "Hopper", "1906-12-09", "US", "US"); err != nil {
		t.Fatalf("InitiateKYC: %v", err)
	}
	for _, c := range svc.GetAMLCheck("u3") {
		if c.Status != "FAIL" || c.Severity != "HIGH" {
			t.Fatalf("expected the screener outcome, got %s/%s", c.Status, c.Severity)
		}
	}
}

func TestUpgradeKYCRequiresReVerification(t *testing.T) {
	svc := newProfile(t)
	svc.SetVerifier(&stubVerifier{docOK: true, liveOK: true})
	if err := svc.VerifyDocument("u1"); err != nil {
		t.Fatalf("VerifyDocument: %v", err)
	}
	if err := svc.UpgradeKYC("u1", KYCLevelEnhanced); err != nil {
		t.Fatalf("UpgradeKYC: %v", err)
	}
	profile, _ := svc.GetKYCProfile("u1")
	if profile.Status == VerificationStatusApproved {
		t.Fatal("an upgraded profile must return to review, not stay approved")
	}
	if profile.Level != KYCLevelEnhanced {
		t.Fatalf("expected ENHANCED level, got %s", profile.Level)
	}
}

func TestStructuringIsFlaggedForReview(t *testing.T) {
	svc := NewKYCService()
	for i := 0; i < 4; i++ {
		tx := &TransactionMonitor{UserID: "u4", Amount: 3000, Asset: "USDT", Type: "DEPOSIT"}
		if err := svc.ScreenTransaction(tx); err != nil {
			t.Fatalf("ScreenTransaction: %v", err)
		}
		if i == 3 && tx.Status != "REVIEW" {
			t.Fatalf("expected REVIEW after repeated sub-threshold deposits, got %s", tx.Status)
		}
	}
}
