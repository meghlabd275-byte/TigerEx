package compliance

import (
	"context"
	"errors"
	"testing"
)

type fakeScreener struct {
	matched []string
	err     error
}

func (f fakeScreener) Screen(ctx context.Context, name, address, country string) ([]string, error) {
	return f.matched, f.err
}

type fakeReports struct {
	url string
	err error
}

func (f fakeReports) Generate(ctx context.Context, reportType string) (string, error) {
	return f.url, f.err
}

// A service with no screener must refuse to clear a party rather than report a
// screening result it never obtained.
func TestCheckSanctionsFailsClosedWithoutScreener(t *testing.T) {
	svc := NewService(Config{})
	check, err := svc.CheckSanctions(context.Background(), "u1", "Jane Doe", "addr", "US")
	if !errors.Is(err, ErrSanctionsScreenerNotConfigured) {
		t.Fatalf("expected ErrSanctionsScreenerNotConfigured, got %v", err)
	}
	if check != nil {
		t.Fatalf("expected no check on failure, got %+v", check)
	}
}

func TestCheckSanctionsPropagatesScreenerError(t *testing.T) {
	boom := errors.New("feed down")
	svc := NewService(Config{Screener: fakeScreener{err: boom}})
	_, err := svc.CheckSanctions(context.Background(), "u1", "Jane Doe", "addr", "US")
	if !errors.Is(err, boom) {
		t.Fatalf("expected wrapped screener error, got %v", err)
	}
}

func TestCheckSanctionsClearsOnlyWhenScreenerReturnsNoMatch(t *testing.T) {
	svc := NewService(Config{Screener: fakeScreener{}})
	check, err := svc.CheckSanctions(context.Background(), "u1", "Jane Doe", "addr", "US")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if check.Result != "clear" || len(check.MatchedList) != 0 {
		t.Fatalf("expected clear with no matches, got %+v", check)
	}
}

func TestCheckSanctionsFlagsMatches(t *testing.T) {
	svc := NewService(Config{Screener: fakeScreener{matched: []string{"OFAC", "EU_SANCTIONS"}}})
	check, err := svc.CheckSanctions(context.Background(), "u1", "Jane Doe", "addr", "US")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if check.Result != "match" {
		t.Fatalf("expected match, got %q", check.Result)
	}
	if len(check.MatchedList) != 2 {
		t.Fatalf("expected 2 matched lists, got %v", check.MatchedList)
	}
}

func TestGenerateReportFailsClosedWithoutGenerator(t *testing.T) {
	svc := NewService(Config{})
	report, err := svc.GenerateReport(context.Background(), &ReportRequest{UserID: "u1", Type: "tax"})
	if !errors.Is(err, ErrReportGeneratorNotConfigured) {
		t.Fatalf("expected ErrReportGeneratorNotConfigured, got %v", err)
	}
	if report != nil {
		t.Fatalf("expected no report on failure, got %+v", report)
	}
}

func TestGenerateReportRejectsEmptyArtefact(t *testing.T) {
	svc := NewService(Config{Reports: fakeReports{url: ""}})
	_, err := svc.GenerateReport(context.Background(), &ReportRequest{UserID: "u1", Type: "tax"})
	if !errors.Is(err, ErrReportGeneratorNotConfigured) {
		t.Fatalf("expected ErrReportGeneratorNotConfigured for empty url, got %v", err)
	}
}

func TestGenerateReportReturnsRealArtefact(t *testing.T) {
	svc := NewService(Config{Reports: fakeReports{url: "https://reports.example/real.csv"}})
	report, err := svc.GenerateReport(context.Background(), &ReportRequest{UserID: "u1", Type: "tax"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if report.URL != "https://reports.example/real.csv" {
		t.Fatalf("expected generator url, got %q", report.URL)
	}
}

func TestReportSuspiciousActivityIsRetrievable(t *testing.T) {
	svc := NewService(Config{})
	activity, err := svc.ReportSuspiciousActivity(context.Background(), "u1", "structuring", 12000)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	got, err := svc.GetSuspiciousActivity(activity.ID)
	if err != nil {
		t.Fatalf("expected to retrieve the report, got %v", err)
	}
	if got.ID != activity.ID {
		t.Fatalf("retrieved wrong case: %+v", got)
	}
	if _, err := svc.GetSuspiciousActivity("missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}
