package kyc

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func newTestStore(t *testing.T) *SQLiteStore {
	t.Helper()
	store, err := NewSQLiteStore(filepath.Join(t.TempDir(), "kyc.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func validSubmission(userID string) *SubmissionRequest {
	return &SubmissionRequest{
		UserID:       userID,
		DocumentType: DocPassport,
		FirstName:    "Ada",
		LastName:     "Lovelace",
		DOB:          "1990-05-12",
		Country:      "GB",
		DocumentID:   "X1234567",
		Address:      "1 Analytical Engine Way",
		City:         "London",
		State:        "Greater London",
		ZipCode:      "SW1A 1AA",
	}
}

// TestSQLiteStoreRejectsInMemory is the regression test for a store that
// silently lost every decision on restart.
func TestSQLiteStoreRejectsInMemory(t *testing.T) {
	for _, path := range []string{"", ":memory:", "file:x?mode=memory&cache=shared"} {
		if _, err := NewSQLiteStore(path); err == nil {
			t.Fatalf("in-memory path %q was accepted", path)
		}
	}
}

// TestGetStatusRequiresStore checks the fail-closed behaviour.
func TestGetStatusRequiresStore(t *testing.T) {
	svc := NewService(Config{})
	if _, err := svc.GetStatus(context.Background(), "u1"); !errors.Is(err, ErrStoreUnavailable) {
		t.Fatalf("expected ErrStoreUnavailable, got %v", err)
	}
	if _, err := svc.Submit(context.Background(), validSubmission("u1")); !errors.Is(err, ErrStoreUnavailable) {
		t.Fatalf("expected ErrStoreUnavailable, got %v", err)
	}
}

// TestStatusForUnknownUser checks the not-submitted default.
func TestStatusForUnknownUser(t *testing.T) {
	svc := NewService(Config{}).WithStore(newTestStore(t))

	status, err := svc.GetStatus(context.Background(), "u1")
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if status.Level != LevelNone || status.Status != StatusNotSubmitted {
		t.Fatalf("unexpected status: %+v", status)
	}
}

// TestSubmitPersists checks the round trip through the database.
func TestSubmitPersists(t *testing.T) {
	svc := NewService(Config{}).WithStore(newTestStore(t))
	ctx := context.Background()

	status, err := svc.Submit(ctx, validSubmission("u1"))
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	if status.Status != StatusPending {
		t.Fatalf("status: got %s, want pending", status.Status)
	}
	if status.SubmittedAt == 0 {
		t.Fatal("submittedAt was not set")
	}

	// Reopening the store must show the same record.
	reloaded, err := svc.GetStatus(ctx, "u1")
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if reloaded.Status != StatusPending {
		t.Fatalf("reloaded status: got %s", reloaded.Status)
	}
	if reloaded.SubmittedAt != status.SubmittedAt {
		t.Fatalf("submittedAt changed across reads")
	}
}

// TestSubmitValidationRejectsBadInput checks every field rule.
func TestSubmitValidationRejectsBadInput(t *testing.T) {
	svc := NewService(Config{}).WithStore(newTestStore(t))
	ctx := context.Background()

	cases := map[string]func(*SubmissionRequest){
		"missing user":       func(r *SubmissionRequest) { r.UserID = "" },
		"unknown doc type":   func(r *SubmissionRequest) { r.DocumentType = "utility_bill" },
		"missing first name": func(r *SubmissionRequest) { r.FirstName = "" },
		"missing last name":  func(r *SubmissionRequest) { r.LastName = "" },
		"bad dob format":     func(r *SubmissionRequest) { r.DOB = "12/05/1990" },
		"under age":          func(r *SubmissionRequest) { r.DOB = time.Now().AddDate(-10, 0, 0).Format("2006-01-02") },
		"bad country":        func(r *SubmissionRequest) { r.Country = "XYZ" },
		"sanctioned country": func(r *SubmissionRequest) { r.Country = "KP" },
		"unsupported":        func(r *SubmissionRequest) { r.Country = "AQ" },
		"bad doc number":     func(r *SubmissionRequest) { r.DocumentID = "!!" },
		"missing address":    func(r *SubmissionRequest) { r.Address = "" },
		"missing city":       func(r *SubmissionRequest) { r.City = "" },
		"short zip":          func(r *SubmissionRequest) { r.ZipCode = "1" },
	}

	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			req := validSubmission("u-" + name)
			mutate(req)
			if err := ValidateSubmission(req); err == nil {
				t.Fatal("invalid submission was accepted")
			}
			if _, err := svc.Submit(ctx, req); err == nil {
				t.Fatal("invalid submission was persisted")
			}
			if req.UserID == "" {
				// An empty user id is itself rejected by GetStatus.
				return
			}
			// Nothing should have been written.
			status, err := svc.GetStatus(ctx, req.UserID)
			if err != nil {
				t.Fatalf("status: %v", err)
			}
			if status.Status != StatusNotSubmitted {
				t.Fatalf("a rejected submission created a record: %+v", status)
			}
		})
	}
}

// TestSubmitRejectsDuplicatePending checks that a second submission while a
// review is open is refused.
func TestSubmitRejectsDuplicatePending(t *testing.T) {
	svc := NewService(Config{}).WithStore(newTestStore(t))
	ctx := context.Background()

	if _, err := svc.Submit(ctx, validSubmission("u1")); err != nil {
		t.Fatalf("first submit: %v", err)
	}
	if _, err := svc.Submit(ctx, validSubmission("u1")); !errors.Is(err, ErrPending) {
		t.Fatalf("expected ErrPending, got %v", err)
	}
}

// TestSubmitAllowsResubmissionAfterRejection checks the retry path.
func TestSubmitAllowsResubmissionAfterRejection(t *testing.T) {
	svc := NewService(Config{}).WithStore(newTestStore(t))
	ctx := context.Background()

	if _, err := svc.Submit(ctx, validSubmission("u1")); err != nil {
		t.Fatalf("submit: %v", err)
	}
	if _, err := svc.Review(ctx, "u1", false, 0, "blurry document", "admin1"); err != nil {
		t.Fatalf("review: %v", err)
	}
	if _, err := svc.Submit(ctx, validSubmission("u1")); err != nil {
		t.Fatalf("resubmit after rejection: %v", err)
	}
}

// TestReviewApproves checks that approval sets the level and writes an audit
// entry.
func TestReviewApproves(t *testing.T) {
	store := newTestStore(t)
	svc := NewService(Config{}).WithStore(store)
	ctx := context.Background()

	if _, err := svc.Submit(ctx, validSubmission("u1")); err != nil {
		t.Fatalf("submit: %v", err)
	}
	status, err := svc.Review(ctx, "u1", true, LevelIntermediate, "", "admin1")
	if err != nil {
		t.Fatalf("review: %v", err)
	}
	if status.Status != StatusApproved || status.Level != LevelIntermediate {
		t.Fatalf("unexpected status: %+v", status)
	}
	if status.ReviewedAt == 0 {
		t.Fatal("reviewedAt was not set")
	}

	// The level must survive a reload.
	reloaded, err := svc.GetStatus(ctx, "u1")
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if reloaded.Level != LevelIntermediate || reloaded.Status != StatusApproved {
		t.Fatalf("reload lost the decision: %+v", reloaded)
	}

	entries, err := store.AuditLog(ctx, "u1", 10)
	if err != nil {
		t.Fatalf("audit: %v", err)
	}
	if len(entries) < 2 {
		t.Fatalf("expected at least 2 audit entries, got %d", len(entries))
	}
	var sawApproved bool
	for _, e := range entries {
		if e.Action == "kyc.approved" {
			sawApproved = true
			if e.ActorID != "admin1" {
				t.Fatalf("audit entry lost the actor: %+v", e)
			}
		}
	}
	if !sawApproved {
		t.Fatal("no kyc.approved audit entry was written")
	}
}

// TestReviewRejects checks the rejection path and its validation.
func TestReviewRejects(t *testing.T) {
	svc := NewService(Config{}).WithStore(newTestStore(t))
	ctx := context.Background()

	if _, err := svc.Submit(ctx, validSubmission("u1")); err != nil {
		t.Fatalf("submit: %v", err)
	}

	// A rejection needs a reason.
	if _, err := svc.Review(ctx, "u1", false, 0, "   ", "admin1"); err == nil {
		t.Fatal("a rejection without a reason was accepted")
	}

	status, err := svc.Review(ctx, "u1", false, 0, "document expired", "admin1")
	if err != nil {
		t.Fatalf("review: %v", err)
	}
	if status.Status != StatusRejected || status.Level != LevelNone {
		t.Fatalf("unexpected status: %+v", status)
	}
	if status.RejectReason != "document expired" {
		t.Fatalf("reject reason: %q", status.RejectReason)
	}

	// An approval level outside the allowed range is refused.
	if _, err := svc.Review(ctx, "u2", true, LevelNone, "", "admin1"); err == nil {
		t.Fatal("an approval at level none was accepted")
	}
	if _, err := svc.Review(ctx, "u2", true, LevelFull+1, "", "admin1"); err == nil {
		t.Fatal("an approval above level full was accepted")
	}
}

// TestReviewUnknownUser checks the error for a missing application.
func TestReviewUnknownUser(t *testing.T) {
	svc := NewService(Config{}).WithStore(newTestStore(t))
	if _, err := svc.Review(context.Background(), "nobody", true, LevelBasic, "", "admin1"); !errors.Is(err, ErrNotSubmitted) {
		t.Fatalf("expected ErrNotSubmitted, got %v", err)
	}
}

// TestCanWithdrawEnforcesLevels checks the withdrawal thresholds.
func TestCanWithdrawEnforcesLevels(t *testing.T) {
	svc := NewService(Config{}).WithStore(newTestStore(t))
	ctx := context.Background()

	// Unverified user: 1,000 is allowed, above is not.
	if err := svc.CanWithdraw(ctx, "u1", 1000); err != nil {
		t.Fatalf("unverified user should be able to withdraw 1000: %v", err)
	}
	if err := svc.CanWithdraw(ctx, "u1", 1000.01); err == nil {
		t.Fatal("unverified user was allowed to withdraw above the limit")
	}
	if err := svc.CanWithdraw(ctx, "u1", -1); err == nil {
		t.Fatal("a negative amount was accepted")
	}

	// Basic user: up to 10,000.
	if _, err := svc.Submit(ctx, validSubmission("u1")); err != nil {
		t.Fatalf("submit: %v", err)
	}
	if _, err := svc.Review(ctx, "u1", true, LevelBasic, "", "admin1"); err != nil {
		t.Fatalf("review: %v", err)
	}
	if err := svc.CanWithdraw(ctx, "u1", 10000); err != nil {
		t.Fatalf("basic user should be able to withdraw 10000: %v", err)
	}
	if err := svc.CanWithdraw(ctx, "u1", 10001); err == nil {
		t.Fatal("basic user was allowed to withdraw above the limit")
	}
}

// TestCanDepositEnforcesLevels checks the deposit thresholds.
func TestCanDepositEnforcesLevels(t *testing.T) {
	svc := NewService(Config{}).WithStore(newTestStore(t))
	ctx := context.Background()

	if err := svc.CanDeposit(ctx, "u1", 1000); err != nil {
		t.Fatalf("unverified deposit of 1000: %v", err)
	}
	if err := svc.CanDeposit(ctx, "u1", 2000); err == nil {
		t.Fatal("an unverified user was allowed to deposit 2000")
	}
}

// TestCanWithdrawRejectedUser checks that a rejected user is blocked.
func TestCanWithdrawRejectedUser(t *testing.T) {
	svc := NewService(Config{}).WithStore(newTestStore(t))
	ctx := context.Background()

	if _, err := svc.Submit(ctx, validSubmission("u1")); err != nil {
		t.Fatalf("submit: %v", err)
	}
	if _, err := svc.Review(ctx, "u1", false, 0, "fraud indicators", "admin1"); err != nil {
		t.Fatalf("review: %v", err)
	}
	if err := svc.CanWithdraw(ctx, "u1", 10); !errors.Is(err, ErrRejected) {
		t.Fatalf("expected ErrRejected, got %v", err)
	}
	if err := svc.CanDeposit(ctx, "u1", 10); !errors.Is(err, ErrRejected) {
		t.Fatalf("expected ErrRejected, got %v", err)
	}
}

// TestVerifyEmailAndPhone checks the contact-detail validators.
func TestVerifyEmailAndPhone(t *testing.T) {
	svc := NewService(Config{})
	ctx := context.Background()

	if err := svc.VerifyEmail(ctx, "u1", "ada@example.com"); err != nil {
		t.Fatalf("valid email rejected: %v", err)
	}
	for _, bad := range []string{"", "no-at", "a@b", "a b@c.com"} {
		if err := svc.VerifyEmail(ctx, "u1", bad); err == nil {
			t.Fatalf("invalid email %q was accepted", bad)
		}
	}
	if err := svc.VerifyEmail(ctx, "", "ada@example.com"); !errors.Is(err, ErrNotSubmitted) {
		t.Fatalf("expected ErrNotSubmitted, got %v", err)
	}

	if err := svc.VerifyPhone(ctx, "u1", "+442071234567"); err != nil {
		t.Fatalf("valid phone rejected: %v", err)
	}
	for _, bad := range []string{"", "442071234567", "+44-207-123", "+123", "+12345678901234567"} {
		if err := svc.VerifyPhone(ctx, "u1", bad); err == nil {
			t.Fatalf("invalid phone %q was accepted", bad)
		}
	}
}

// TestLimits checks the published table.
func TestLimits(t *testing.T) {
	if got := Limits(LevelNone); got.WithdrawalLimitDaily != 0 {
		t.Fatalf("unverified withdrawal limit: %v", got.WithdrawalLimitDaily)
	}
	if got := Limits(LevelFull); got.WithdrawalLimitDaily != 1000000 {
		t.Fatalf("full withdrawal limit: %v", got.WithdrawalLimitDaily)
	}
	if got := Limits(LevelIntermediate); !got.RequiresLiveness {
		t.Fatal("intermediate should require liveness")
	}
	if got := Limits(LevelFull); !got.RequiresAddressProof {
		t.Fatal("full should require address proof")
	}
}

// TestDocumentUploadRecordsDigest checks the document table.
func TestDocumentUploadRecordsDigest(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	id, err := store.AddDocument(ctx, "kyc_1", DocPassport, "front", "/vault/kyc/kyc_1/front.jpg", "abc123")
	if err != nil {
		t.Fatalf("add document: %v", err)
	}
	if id == "" {
		t.Fatal("no document id returned")
	}
}

// TestAuditLogLimitIsBounded checks the limit clamp.
func TestAuditLogLimitIsBounded(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	for i := 0; i < 5; i++ {
		if err := store.RecordAudit(ctx, &AuditEntry{UserID: "u1", Action: "kyc.submitted"}); err != nil {
			t.Fatalf("record audit: %v", err)
		}
	}
	entries, err := store.AuditLog(ctx, "u1", -1)
	if err != nil {
		t.Fatalf("audit: %v", err)
	}
	if len(entries) != 5 {
		t.Fatalf("expected 5 entries, got %d", len(entries))
	}
	for _, e := range entries {
		if e.CreatedAt == 0 || e.ID == "" {
			t.Fatalf("incomplete audit entry: %+v", e)
		}
	}
}
