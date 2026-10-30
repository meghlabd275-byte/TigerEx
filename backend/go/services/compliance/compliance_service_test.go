package compliance

import (
	"context"
	"errors"
	"testing"
)

type stubGenerator struct {
	path string
	err  error
}

func (s *stubGenerator) Generate(_ context.Context, _, _ string) (string, error) {
	return s.path, s.err
}

func TestNewComplianceManagerSeedsNoLicenses(t *testing.T) {
	cm := NewComplianceManager()
	if got := len(cm.GetLicenses()); got != 0 {
		t.Fatalf("licenses = %d, want 0 so no placeholder licence is reported", got)
	}
	if got := len(cm.GetRequirements()); got != 0 {
		t.Fatalf("requirements = %d, want 0", got)
	}
}

func TestGenerateReportFailsClosedWithoutGenerator(t *testing.T) {
	cm := NewComplianceManager()
	report, err := cm.GenerateReport("trades", "2026-01")
	if !errors.Is(err, ErrReportGeneratorNotConfigured) {
		t.Fatalf("err = %v, want ErrReportGeneratorNotConfigured", err)
	}
	if report != nil {
		t.Fatal("report = non-nil, want nil so nothing unproduced is reported complete")
	}
	if len(cm.GetReports(0)) != 0 {
		t.Fatal("a failed generation must not be recorded")
	}
}

func TestGenerateReportRecordsProducedArtifact(t *testing.T) {
	cm := NewComplianceManager()
	cm.SetReportGenerator(&stubGenerator{path: "/reports/trades-2026-01.pdf"})

	report, err := cm.GenerateReport("trades", "2026-01")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if report.Status != "completed" || report.FilePath != "/reports/trades-2026-01.pdf" {
		t.Fatalf("report = %+v, want completed with the produced path", report)
	}
}

func TestProofOfReserveRootIsDeterministic(t *testing.T) {
	cm := NewComplianceManager()
	first, err := cm.GenerateProofOfReserve("BTC", 100, 60, 40)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	second, err := cm.GenerateProofOfReserve("BTC", 100, 60, 40)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if first.MerkleRoot != second.MerkleRoot {
		t.Fatalf("roots differ for identical reserves: %s vs %s", first.MerkleRoot, second.MerkleRoot)
	}
	third, err := cm.GenerateProofOfReserve("BTC", 101, 60, 40)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if third.MerkleRoot == first.MerkleRoot {
		t.Fatal("roots must differ when the reserves differ")
	}
	if len(first.MerkleRoot) != 64 {
		t.Fatalf("root length = %d, want 64 hex chars", len(first.MerkleRoot))
	}
}

func TestAddRequirementRejectsEmpty(t *testing.T) {
	cm := NewComplianceManager()
	if err := cm.AddRequirement(ComplianceRequirement{}); err == nil {
		t.Fatal("expected empty requirement to be rejected")
	}
	if err := cm.AddRequirement(ComplianceRequirement{Regulation: "MiCA", Requirement: "CASP registration"}); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(cm.GetRequirements()) != 1 {
		t.Fatal("expected the requirement to be recorded")
	}
}
