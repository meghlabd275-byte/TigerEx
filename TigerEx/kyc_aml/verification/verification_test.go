package kyc

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"mime/multipart"
	"testing"
	"time"
)

// stubProvider is a verification provider whose verdict each test controls.
type stubProvider struct {
	valid   bool
	verifyE error

	pepMatches []PEPMatch
	pepErr     error
}

func (p *stubProvider) VerifyIdentity(ctx context.Context, data *VerificationData) (*VerificationResult, error) {
	if p.verifyE != nil {
		return nil, p.verifyE
	}
	return &VerificationResult{Valid: p.valid, Score: 1, Confidence: 1}, nil
}

func (p *stubProvider) VerifyDocument(ctx context.Context, doc *KYCDocument) (*VerificationResult, error) {
	return &VerificationResult{Valid: p.valid}, nil
}

func (p *stubProvider) CheckPEP(ctx context.Context, name string) ([]PEPMatch, error) {
	return p.pepMatches, p.pepErr
}

func (p *stubProvider) CheckSanctions(ctx context.Context, name string) ([]SanctionMatch, error) {
	return nil, nil
}

// uploadFile wraps bytes as a multipart.File.
func uploadFile(t *testing.T, content []byte) multipart.File {
	t.Helper()
	return multipart.File(&sliceFile{data: content})
}

type sliceFile struct {
	data []byte
	pos  int
}

func (f *sliceFile) Read(p []byte) (int, error) {
	if f.pos >= len(f.data) {
		return 0, io.EOF
	}
	n := copy(p, f.data[f.pos:])
	f.pos += n
	return n, nil
}
func (f *sliceFile) ReadAt(p []byte, off int64) (int, error) { return 0, nil }
func (f *sliceFile) Seek(offset int64, whence int) (int64, error) {
	f.pos = int(offset)
	return offset, nil
}
func (f *sliceFile) Close() error { return nil }

func newTestApp(level VerificationLevel) *KYCApplication {
	return &KYCApplication{
		ID:          "app_1",
		UserID:      "user_1",
		Level:       level,
		FirstName:   sql.NullString{String: "Ada", Valid: true},
		LastName:    sql.NullString{String: "Lovelace", Valid: true},
		DateOfBirth: sql.NullTime{Time: time.Date(1815, 12, 10, 0, 0, 0, 0, time.UTC), Valid: true},
		Nationality: sql.NullString{String: "GB", Valid: true},
		IDNumber:    sql.NullString{String: "X1234567", Valid: true},
		Country:     sql.NullString{String: "GB", Valid: true},
	}
}

// The old implementation left allPassed true when no provider was configured
// and no document was uploaded, so every application auto-approved. That must
// never happen again.
func TestKYCDoesNotAutoApproveWithoutEvidence(t *testing.T) {
	ks := NewKYCService() // no providers, no documents

	app := newTestApp(LevelBasic)
	ks.mu.Lock()
	ks.applications[app.ID] = app
	ks.mu.Unlock()

	result, err := ks.ProcessApplication(context.Background(), app.ID)
	if err != nil {
		t.Fatalf("process failed: %v", err)
	}
	if result.Status == KYCStatusApproved {
		t.Fatal("an application with no provider and no document must not be approved")
	}
	if result.Status != KYCStatusReviewing {
		t.Fatalf("expected REVIEWING, got %s", result.Status)
	}
}

// With a provider that rejects, the application must not be approved.
func TestKYCRejectsWhenProviderFails(t *testing.T) {
	ks := NewKYCService()
	ks.providers["stub"] = &stubProvider{valid: false}

	app := newTestApp(LevelBasic)
	ks.mu.Lock()
	ks.applications[app.ID] = app
	ks.mu.Unlock()

	result, err := ks.ProcessApplication(context.Background(), app.ID)
	if err != nil {
		t.Fatalf("process failed: %v", err)
	}
	if result.Status == KYCStatusApproved {
		t.Fatal("a rejected identity must not be approved")
	}
}

// A provider that passes but with no verified document must not approve either.
func TestKYCRequiresVerifiedDocument(t *testing.T) {
	ks := NewKYCService()
	ks.providers["stub"] = &stubProvider{valid: true}

	app := newTestApp(LevelBasic)
	ks.mu.Lock()
	ks.applications[app.ID] = app
	ks.mu.Unlock()

	result, err := ks.ProcessApplication(context.Background(), app.ID)
	if err != nil {
		t.Fatalf("process failed: %v", err)
	}
	if result.Status == KYCStatusApproved {
		t.Fatal("passing identity with no verified document must not approve")
	}
}

// Only when the provider passes AND the required documents are verified does the
// application approve.
func TestKYCApprovesWithProviderAndVerifiedDocument(t *testing.T) {
	ks := NewKYCService()
	ks.providers["stub"] = &stubProvider{valid: true}

	app := newTestApp(LevelBasic)
	ks.mu.Lock()
	ks.applications[app.ID] = app
	ks.documents[app.UserID] = []*KYCDocument{
		{DocumentType: DocumentNationalID, Status: "verified"},
	}
	ks.mu.Unlock()

	result, err := ks.ProcessApplication(context.Background(), app.ID)
	if err != nil {
		t.Fatalf("process failed: %v", err)
	}
	if result.Status != KYCStatusApproved {
		t.Fatalf("expected APPROVED, got %s", result.Status)
	}
}

// A provider error must not be mistaken for a pass.
func TestKYCProviderErrorIsNotAPass(t *testing.T) {
	ks := NewKYCService()
	ks.providers["stub"] = &stubProvider{verifyE: fmt.Errorf("provider down")}

	app := newTestApp(LevelBasic)
	ks.mu.Lock()
	ks.applications[app.ID] = app
	ks.documents[app.UserID] = []*KYCDocument{
		{DocumentType: DocumentNationalID, Status: "verified"},
	}
	ks.mu.Unlock()

	result, err := ks.ProcessApplication(context.Background(), app.ID)
	if err != nil {
		t.Fatalf("process failed: %v", err)
	}
	if result.Status == KYCStatusApproved {
		t.Fatal("a provider error must not approve")
	}
}

// A filename without an extension used to panic.
func TestIsAllowedFileTypeDoesNotPanic(t *testing.T) {
	for _, name := range []string{"passport", "", ".", "a.", "noext"} {
		if isAllowedFileType(name) {
			t.Fatalf("%q should not be allowed", name)
		}
	}
	for _, name := range []string{"id.jpg", "id.JPEG", "scan.png", "doc.pdf"} {
		if !isAllowedFileType(name) {
			t.Fatalf("%q should be allowed", name)
		}
	}
}

// Content sniffing must reject a file whose bytes do not match an image or PDF,
// even when the name says .jpg.
func TestDetectContentType(t *testing.T) {
	jpeg := []byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00}
	png := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00}
	pdf := []byte{0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34}
	script := []byte("#!/bin/sh\nrm -rf /\n")

	if detectContentType(jpeg) != "image/jpeg" {
		t.Fatal("jpeg not detected")
	}
	if detectContentType(png) != "image/png" {
		t.Fatal("png not detected")
	}
	if detectContentType(pdf) != "application/pdf" {
		t.Fatal("pdf not detected")
	}
	if detectContentType(script) != "" {
		t.Fatal("a shell script must not be detected as a document")
	}
}

// Uploading a shell script named passport.jpg must be refused.
func TestUploadDocumentRejectsDisguisedFile(t *testing.T) {
	ks := NewKYCService()

	doc := &KYCDocument{UserID: "user_1", DocumentType: DocumentNationalID, FileName: "passport.jpg"}
	_, err := ks.UploadDocument(context.Background(), doc, uploadFile(t, []byte("#!/bin/sh\nrm -rf /\n")))
	if err == nil {
		t.Fatal("a disguised non-image must be rejected")
	}

	// An empty file is rejected.
	doc = &KYCDocument{UserID: "user_1", DocumentType: DocumentNationalID, FileName: "passport.jpg"}
	if _, err := ks.UploadDocument(context.Background(), doc, uploadFile(t, nil)); err == nil {
		t.Fatal("an empty upload must be rejected")
	}

	// A real JPEG is accepted and its size recorded.
	doc = &KYCDocument{UserID: "user_1", DocumentType: DocumentNationalID, FileName: "passport.jpg"}
	ok, err := ks.UploadDocument(context.Background(), doc, uploadFile(t, []byte{0xFF, 0xD8, 0xFF, 0xE0, 0x01, 0x02}))
	if err != nil {
		t.Fatalf("a real JPEG must be accepted: %v", err)
	}
	if ok.FileSize != 6 || ok.FileHash == "" {
		t.Fatalf("document metadata was not recorded: %+v", ok)
	}
}

// AML screening used an uninitialised package-level map, so it always reported
// CLEAR. A service with no screening provider must report UNSCREENED/HIGH.
func TestAMLFailsClosedWithoutProviders(t *testing.T) {
	ks := NewKYCService()
	app := newTestApp(LevelBasic)

	check, err := ks.RunAMLCheck(context.Background(), "user_1", app)
	if err != nil {
		t.Fatalf("aml check failed: %v", err)
	}
	if check.Status == "COMPLETE" && check.RiskLevel == "LOW" {
		t.Fatal("screening with no provider must not report a clean low-risk result")
	}
	if check.RiskLevel != "HIGH" {
		t.Fatalf("expected HIGH risk when unscreened, got %s", check.RiskLevel)
	}
}

// A provider error must not look like a clean screening.
func TestAMLErrorIsNotClean(t *testing.T) {
	ks := NewKYCService()
	ks.providers["stub"] = &stubProvider{pepErr: fmt.Errorf("screening service down")}
	app := newTestApp(LevelBasic)

	check, err := ks.RunAMLCheck(context.Background(), "user_1", app)
	if err != nil {
		t.Fatalf("aml check failed: %v", err)
	}
	if check.Status != "ERROR" {
		t.Fatalf("expected ERROR status, got %s", check.Status)
	}
	if check.RiskLevel != "HIGH" {
		t.Fatalf("expected HIGH risk, got %s", check.RiskLevel)
	}
}

// A PEP hit must be recorded and raise the risk score.
func TestAMLRecordsPepHit(t *testing.T) {
	ks := NewKYCService()
	ks.providers["stub"] = &stubProvider{
		pepMatches: []PEPMatch{{Name: "Ada Lovelace", Type: "PEP", Score: 0.95}},
	}
	app := newTestApp(LevelBasic)

	check, err := ks.RunAMLCheck(context.Background(), "user_1", app)
	if err != nil {
		t.Fatalf("aml check failed: %v", err)
	}
	if check.MatchesFound != 1 {
		t.Fatalf("expected one match, got %d", check.MatchesFound)
	}
	if check.PepStatus != PEPStatusMatch {
		t.Fatalf("expected PEPStatusMatch, got %s", check.PepStatus)
	}
	if len(ks.watchlistHits["user_1"]) != 1 {
		t.Fatal("the hit was not recorded")
	}
	if check.RiskScore < 30 {
		t.Fatalf("expected the risk score to rise, got %d", check.RiskScore)
	}
}
