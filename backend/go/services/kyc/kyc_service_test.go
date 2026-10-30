package kyc

import (
	"context"
	"errors"
	"testing"
)

type stubScreener struct {
	result *AMLScreenResult
	err    error
	calls  int
}

func (s *stubScreener) Screen(_ context.Context, _, _ string) (*AMLScreenResult, error) {
	s.calls++
	return s.result, s.err
}

func TestRunAMLCheckFailsClosedWithoutScreener(t *testing.T) {
	km := NewKYCManager()
	check, err := km.RunAMLCheck("user-1", "onboarding")
	if !errors.Is(err, ErrAMLScreenerNotConfigured) {
		t.Fatalf("err = %v, want ErrAMLScreenerNotConfigured", err)
	}
	if check != nil {
		t.Fatalf("check = %v, want nil so no fabricated result is stored", check)
	}
	if len(km.amlChecks) != 0 {
		t.Fatalf("amlChecks len = %d, want 0", len(km.amlChecks))
	}
}

func TestRunAMLCheckFailsClosedWhenProviderErrors(t *testing.T) {
	km := NewKYCManager()
	km.SetAMLScreener(&stubScreener{err: errors.New("provider down")})

	check, err := km.RunAMLCheck("user-1", "onboarding")
	if err == nil {
		t.Fatal("expected provider error to propagate")
	}
	if check != nil {
		t.Fatal("expected nil check when the provider fails")
	}
	if len(km.amlChecks) != 0 {
		t.Fatal("a failed screen must not be recorded as a result")
	}
}

func TestRunAMLCheckRequiresReviewForSanctionsHit(t *testing.T) {
	km := NewKYCManager()
	km.SetAMLScreener(&stubScreener{result: &AMLScreenResult{
		RiskScore:       10,
		PEPStatus:       "clear",
		SanctionsStatus: "hit",
	}})

	check, err := km.RunAMLCheck("user-1", "onboarding")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if check.Status != StatusReviewing {
		t.Fatalf("status = %q, want %q", check.Status, StatusReviewing)
	}
}

func TestRunAMLCheckRequiresReviewWhenNotExplicitlyCleared(t *testing.T) {
	km := NewKYCManager()
	// An empty sanctions status is not a clear; it must not be auto-approved.
	km.SetAMLScreener(&stubScreener{result: &AMLScreenResult{RiskScore: 5}})

	check, err := km.RunAMLCheck("user-1", "onboarding")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if check.Status != StatusReviewing {
		t.Fatalf("status = %q, want %q", check.Status, StatusReviewing)
	}
}

func TestRunAMLCheckApprovesOnlyExplicitClears(t *testing.T) {
	km := NewKYCManager()
	km.SetAMLScreener(&stubScreener{result: &AMLScreenResult{
		RiskScore:       20,
		PEPStatus:       "clear",
		SanctionsStatus: "clear",
	}})

	check, err := km.RunAMLCheck("user-1", "onboarding")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if check.Status != StatusApproved {
		t.Fatalf("status = %q, want %q", check.Status, StatusApproved)
	}
	if check.RiskLevel != "low" {
		t.Fatalf("risk level = %q, want low", check.RiskLevel)
	}
}

func TestRiskLevelForScore(t *testing.T) {
	cases := map[int]string{0: "low", 40: "low", 41: "medium", 70: "medium", 71: "high", 100: "high"}
	for score, want := range cases {
		if got := riskLevelForScore(score); got != want {
			t.Errorf("riskLevelForScore(%d) = %q, want %q", score, got, want)
		}
	}
}
