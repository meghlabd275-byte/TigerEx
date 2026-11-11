package kyc

import (
	"context"
	"errors"
	"testing"
)

// stubScreener is a controlled AML rail so the tests can assert the service's
// reaction to a hit, a clean screen and a failure.
type stubScreener struct {
	result *AMLScreenResult
	err    error
}

func (s *stubScreener) Screen(ctx context.Context, fullName, country string) (*AMLScreenResult, error) {
	return s.result, s.err
}

func TestPerformAMLCheckFailsClosedWithoutScreener(t *testing.T) {
	svc := NewKYCService()
	if _, err := svc.StartKYC("u1"); err != nil {
		t.Fatalf("start kyc: %v", err)
	}
	check, err := svc.PerformAMLCheck("u1")
	if err != nil {
		t.Fatalf("perform: %v", err)
	}
	if check.Status == StatusApproved {
		t.Fatal("a screening with no screener must not be approved")
	}
	if check.RiskLevel != "high" {
		t.Fatalf("expected high risk, got %q", check.RiskLevel)
	}
}

func TestPerformAMLCheckSanctionsBlocks(t *testing.T) {
	svc := NewKYCServiceWithScreener(&stubScreener{result: &AMLScreenResult{Sanctions: true, RiskScore: 99}})
	if _, err := svc.StartKYC("u1"); err != nil {
		t.Fatalf("start kyc: %v", err)
	}
	check, err := svc.PerformAMLCheck("u1")
	if err != nil {
		t.Fatalf("perform: %v", err)
	}
	if check.Status == StatusApproved || !check.MatchFound {
		t.Fatalf("sanctions hit must block: status=%v match=%v", check.Status, check.MatchFound)
	}
}

func TestPerformAMLCheckScreenerErrorBlocks(t *testing.T) {
	svc := NewKYCServiceWithScreener(&stubScreener{err: errors.New("upstream down")})
	if _, err := svc.StartKYC("u1"); err != nil {
		t.Fatalf("start kyc: %v", err)
	}
	check, err := svc.PerformAMLCheck("u1")
	if err != nil {
		t.Fatalf("perform: %v", err)
	}
	if check.Status == StatusApproved {
		t.Fatal("a failed screening must not be approved")
	}
}

func TestPerformAMLCheckHighScoreBlocks(t *testing.T) {
	svc := NewKYCServiceWithScreener(&stubScreener{result: &AMLScreenResult{RiskScore: MaxAcceptableRiskScore}})
	if _, err := svc.StartKYC("u1"); err != nil {
		t.Fatalf("start kyc: %v", err)
	}
	check, _ := svc.PerformAMLCheck("u1")
	if check.Status == StatusApproved {
		t.Fatal("a score at the threshold must not auto-clear")
	}
}

func TestProcessKYCRequiresClearedAML(t *testing.T) {
	// Approved documents but no AML run: the application stays in processing.
	svc := NewKYCService()
	if _, err := svc.StartKYC("u1"); err != nil {
		t.Fatalf("start: %v", err)
	}
	doc := &KYCDocument{DocumentType: DocPassport}
	if err := svc.SubmitDocument("u1", doc); err != nil {
		t.Fatalf("submit: %v", err)
	}
	if err := svc.ApproveDocument(doc.ID, "reviewer"); err != nil {
		t.Fatalf("approve doc: %v", err)
	}
	if err := svc.ProcessKYC("u1", "reviewer"); err != nil {
		t.Fatalf("process: %v", err)
	}
	u, _ := svc.GetKYCStatus("u1")
	if u.Status == StatusApproved {
		t.Fatal("KYC approved without an AML clearance")
	}
	if ok, reason := svc.CanWithdraw("u1", 500); ok {
		t.Fatalf("withdrawal allowed without AML clearance: %s", reason)
	}
}

func TestWithdrawLimitsByLevel(t *testing.T) {
	svc := NewKYCServiceWithScreener(&stubScreener{result: &AMLScreenResult{RiskScore: 5}})
	if _, err := svc.StartKYC("u1"); err != nil {
		t.Fatalf("start: %v", err)
	}
	if _, err := svc.PerformAMLCheck("u1"); err != nil {
		t.Fatalf("aml: %v", err)
	}
	// Force an approved, basic-level user directly (two approved docs + cleared
	// AML is the ProcessKYC path; here we assert the withdrawal tiering itself).
	u, _ := svc.GetKYCStatus("u1")
	u.Status = StatusApproved
	u.Level = KYCLevelBasic

	if ok, _ := svc.CanWithdraw("u1", 9000); !ok {
		t.Fatal("basic user should withdraw under $10k")
	}
	if ok, _ := svc.CanWithdraw("u1", 20000); ok {
		t.Fatal("basic user must not withdraw over $10k")
	}
}
