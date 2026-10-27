package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	_ "github.com/mattn/go-sqlite3"
)

// The tests below cover the two defects that mattered most in this service:
// unauthenticated access to every endpoint, and hardcoded verification results.

const testSecret = "test-secret-that-is-long-enough-0123456789"

// sqlOpenTest returns an in-memory database. The pool is pinned to a single
// connection because each SQLite connection to ":memory:" would otherwise be a
// separate database.
func sqlOpenTest() (*sql.DB, error) {
	d, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		return nil, err
	}
	d.SetMaxOpenConns(1)
	return d, nil
}

func newTestSigner(t *testing.T) *tokenSigner {
	t.Helper()
	s, err := newTokenSigner(testSecret, time.Hour)
	if err != nil {
		t.Fatalf("newTokenSigner: %v", err)
	}
	return s
}

func setupTestService(t *testing.T, v Verifier) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)

	var err error
	db, err = sqlOpenTest()
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	if err := createTables(db); err != nil {
		t.Fatalf("create tables: %v", err)
	}

	signer = newTestSigner(t)
	piiSecret = []byte(testSecret)
	verification = v

	return setupRouter()
}

func token(t *testing.T, subject, role string) string {
	t.Helper()
	tok, err := signer.sign(subject, role)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return tok
}

func doRequest(r *gin.Engine, method, path, tok string, body interface{}) *httptest.ResponseRecorder {
	var reader *bytes.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		reader = bytes.NewReader(raw)
	} else {
		reader = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	if tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}

// TestUnauthenticatedRequestsAreRejected is the regression test for the old
// middleware, which accepted any non-empty X-API-Key.
func TestUnauthenticatedRequestsAreRejected(t *testing.T) {
	r := setupTestService(t, nil)

	paths := []struct{ method, path string }{
		{http.MethodPost, "/api/v1/kyc/applications"},
		{http.MethodGet, "/api/v1/kyc/applications"},
		{http.MethodGet, "/api/v1/kyc/applications/app_1"},
		{http.MethodPost, "/api/v1/kyc/documents"},
		{http.MethodGet, "/api/v1/kyc/documents/doc_1"},
		{http.MethodPost, "/api/v1/kyc/selfie"},
		{http.MethodPost, "/api/v1/kyc/liveness"},
		{http.MethodGet, "/api/v1/kyc/status"},
		{http.MethodPost, "/api/v1/kyc/applications/app_1/review"},
		{http.MethodPost, "/api/v1/kyc/applications/app_1/aml-check"},
	}

	for _, p := range paths {
		rec := doRequest(r, p.method, p.path, "", nil)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s %s without a token: want 401, got %d", p.method, p.path, rec.Code)
		}
	}

	// A made-up API key must not be accepted either.
	req := httptest.NewRequest(http.MethodGet, "/api/v1/kyc/status", nil)
	req.Header.Set("X-API-Key", "anything")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("bogus X-API-Key: want 401, got %d", rec.Code)
	}
}

func TestForgedTokenRejected(t *testing.T) {
	r := setupTestService(t, nil)

	for _, bad := range []string{
		"not-a-token",
		"aaaa.bbbb",
		"",
	} {
		rec := doRequest(r, http.MethodGet, "/api/v1/kyc/status", bad, nil)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("token %q: want 401, got %d", bad, rec.Code)
		}
	}
}

func TestTokenSignedWithDifferentSecretRejected(t *testing.T) {
	r := setupTestService(t, nil)

	other, err := newTokenSigner("a-completely-different-secret-value-1234567890", time.Hour)
	if err != nil {
		t.Fatalf("signer: %v", err)
	}
	forged, err := other.sign("victim", roleAdmin)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	rec := doRequest(r, http.MethodGet, "/api/v1/kyc/status", forged, nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("foreign-signed token: want 401, got %d", rec.Code)
	}
}

func TestExpiredTokenRejected(t *testing.T) {
	r := setupTestService(t, nil)

	// Sign a token as if it had been issued two hours ago, which puts its
	// expiry in the past.
	tok, err := signer.signAt("user_1", roleUser, time.Now().Add(-2*time.Hour))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	rec := doRequest(r, http.MethodGet, "/api/v1/kyc/status", tok, nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expired token: want 401, got %d", rec.Code)
	}
}

// TestReviewRequiresAdmin covers the endpoint that grants a verification tier.
func TestReviewRequiresAdmin(t *testing.T) {
	r := setupTestService(t, nil)

	userTok := token(t, "user_1", roleUser)
	rec := doRequest(r, http.MethodPost, "/api/v1/kyc/applications/app_1/review", userTok,
		map[string]interface{}{"applicationId": "app_1", "approved": true, "tier": 3})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("non-admin review: want 403, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestCrossUserAccessDenied covers the old behaviour where any caller could
// read another user's application by guessing its id.
func TestCrossUserAccessDenied(t *testing.T) {
	r := setupTestService(t, nil)

	alice := token(t, "alice", roleUser)
	bob := token(t, "bob", roleUser)

	// Alice submits an application.
	rec := doRequest(r, http.MethodPost, "/api/v1/kyc/applications", alice, map[string]interface{}{
		"firstName": "Alice", "lastName": "Anderson", "dateOfBirth": "1990-01-01",
		"nationality": "GB", "documentType": "passport", "documentNumber": "AB1234567",
		"documentCountry": "GB", "address": "1 High St", "city": "London",
		"postalCode": "SW1A 1AA", "country": "GB",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("submit: want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var submitted struct {
		Data struct {
			ApplicationID string `json:"applicationId"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &submitted); err != nil {
		t.Fatalf("decode submit: %v", err)
	}
	appID := submitted.Data.ApplicationID
	if appID == "" {
		t.Fatal("no application id returned")
	}

	// Alice can read it.
	rec = doRequest(r, http.MethodGet, "/api/v1/kyc/applications/"+appID, alice, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("owner read: want 200, got %d: %s", rec.Code, rec.Body.String())
	}

	// Bob cannot.
	rec = doRequest(r, http.MethodGet, "/api/v1/kyc/applications/"+appID, bob, nil)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("cross-user read: want 403, got %d", rec.Code)
	}

	// Bob cannot attach a document to Alice's application either.
	rec = doRequest(r, http.MethodPost, "/api/v1/kyc/documents", bob, map[string]interface{}{
		"applicationId": appID, "documentType": "passport", "side": "front",
		"fileHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("cross-user document upload: want 403, got %d", rec.Code)
	}

	// Nor a selfie.
	rec = doRequest(r, http.MethodPost, "/api/v1/kyc/selfie", bob, map[string]interface{}{
		"applicationId": appID,
		"fileHash":      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
	})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("cross-user selfie upload: want 403, got %d", rec.Code)
	}
}

// TestDocumentStaysUnverifiedWithoutVerifier covers the hardcoded
// "doc.Verified = true; doc.VerificationScore = 0.95".
func TestDocumentStaysUnverifiedWithoutVerifier(t *testing.T) {
	r := setupTestService(t, nil)
	tok := token(t, "user_1", roleUser)

	appID := submitApplication(t, r, tok)

	rec := doRequest(r, http.MethodPost, "/api/v1/kyc/documents", tok, map[string]interface{}{
		"applicationId": appID, "documentType": "passport", "side": "front",
		"fileHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("upload document: want 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp struct {
		Data struct {
			Verified          bool    `json:"verified"`
			VerificationScore float64 `json:"verificationScore"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Data.Verified {
		t.Fatal("document marked verified with no verifier configured")
	}
	if resp.Data.VerificationScore != 0 {
		t.Fatalf("want zero score, got %v", resp.Data.VerificationScore)
	}
}

// TestDocumentVerifiedByVerifier is the positive path.
func TestDocumentVerifiedByVerifier(t *testing.T) {
	r := setupTestService(t, &stubVerifier{docScore: 0.95, selfieScore: 0.93, liveness: true})
	tok := token(t, "user_1", roleUser)
	appID := submitApplication(t, r, tok)

	rec := doRequest(r, http.MethodPost, "/api/v1/kyc/documents", tok, map[string]interface{}{
		"applicationId": appID, "documentType": "passport", "side": "front",
		"fileHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	})
	var resp struct {
		Data struct {
			Verified bool `json:"verified"`
		} `json:"data"`
	}
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if !resp.Data.Verified {
		t.Fatalf("document not verified despite a passing score: %s", rec.Body.String())
	}
}

// TestLivenessFailsClosedWithoutVerifier covers "livenessPassed := true".
func TestLivenessFailsClosedWithoutVerifier(t *testing.T) {
	r := setupTestService(t, nil)
	tok := token(t, "user_1", roleUser)
	appID := submitApplication(t, r, tok)

	rec := doRequest(r, http.MethodPost, "/api/v1/kyc/liveness", tok, map[string]interface{}{
		"applicationId": appID, "challenge": "turn-left-1234",
	})
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("liveness without verifier: want 503, got %d: %s", rec.Code, rec.Body.String())
	}

	// A missing challenge is a client error, not a pass.
	rec = doRequest(r, http.MethodPost, "/api/v1/kyc/liveness", tok, map[string]interface{}{
		"applicationId": appID,
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("liveness without challenge: want 400, got %d", rec.Code)
	}
}

// TestAMLFailsClosedWithoutVerifier covers the hardcoded "clear" result.
func TestAMLFailsClosedWithoutVerifier(t *testing.T) {
	r := setupTestService(t, nil)
	tok := token(t, "user_1", roleUser)
	appID := submitApplication(t, r, tok)

	rec := doRequest(r, http.MethodPost, "/api/v1/kyc/applications/"+appID+"/aml-check", tok, nil)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("AML without verifier: want 503, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestApprovalRequiresEvidence covers the tier check on the review endpoint.
func TestApprovalRequiresEvidence(t *testing.T) {
	r := setupTestService(t, nil)
	userTok := token(t, "user_1", roleUser)
	adminTok := token(t, "admin_1", roleAdmin)
	appID := submitApplication(t, r, userTok)

	// Nothing has been verified, so an approval must be refused.
	rec := doRequest(r, http.MethodPost, "/api/v1/kyc/applications/"+appID+"/review", adminTok,
		map[string]interface{}{"applicationId": appID, "approved": true, "tier": 3})
	if rec.Code != http.StatusConflict {
		t.Fatalf("approve unverified: want 409, got %d: %s", rec.Code, rec.Body.String())
	}

	// An admin can still reject.
	rec = doRequest(r, http.MethodPost, "/api/v1/kyc/applications/"+appID+"/review", adminTok,
		map[string]interface{}{"applicationId": appID, "approved": false, "reason": "illegible"})
	if rec.Code != http.StatusOK {
		t.Fatalf("reject: want 200, got %d: %s", rec.Code, rec.Body.String())
	}

	// A second decision on the same application is refused.
	rec = doRequest(r, http.MethodPost, "/api/v1/kyc/applications/"+appID+"/review", adminTok,
		map[string]interface{}{"applicationId": appID, "approved": false, "reason": "again"})
	if rec.Code != http.StatusConflict {
		t.Fatalf("double decision: want 409, got %d", rec.Code)
	}
}

// TestFullApprovalPath exercises document, selfie, liveness, AML, then review.
func TestFullApprovalPath(t *testing.T) {
	r := setupTestService(t, &stubVerifier{
		docScore: 0.9, selfieScore: 0.9, liveness: true,
		aml: &AMLScreenResult{Result: "clear", RiskScore: 12, Countries: []string{"GB"}},
	})
	userTok := token(t, "user_1", roleUser)
	adminTok := token(t, "admin_1", roleAdmin)
	appID := submitApplication(t, r, userTok)

	hash := "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"

	if rec := doRequest(r, http.MethodPost, "/api/v1/kyc/documents", userTok, map[string]interface{}{
		"applicationId": appID, "documentType": "passport", "side": "front", "fileHash": hash,
	}); rec.Code != http.StatusOK {
		t.Fatalf("document: %d %s", rec.Code, rec.Body.String())
	}

	if rec := doRequest(r, http.MethodPost, "/api/v1/kyc/selfie", userTok, map[string]interface{}{
		"applicationId": appID, "fileHash": hash,
	}); rec.Code != http.StatusOK {
		t.Fatalf("selfie: %d %s", rec.Code, rec.Body.String())
	}

	if rec := doRequest(r, http.MethodPost, "/api/v1/kyc/liveness", userTok, map[string]interface{}{
		"applicationId": appID, "challenge": "blink-twice",
	}); rec.Code != http.StatusOK {
		t.Fatalf("liveness: %d %s", rec.Code, rec.Body.String())
	}

	if rec := doRequest(r, http.MethodPost, "/api/v1/kyc/applications/"+appID+"/aml-check", userTok, nil); rec.Code != http.StatusOK {
		t.Fatalf("aml: %d %s", rec.Code, rec.Body.String())
	}

	rec := doRequest(r, http.MethodPost, "/api/v1/kyc/applications/"+appID+"/review", adminTok,
		map[string]interface{}{"applicationId": appID, "approved": true, "tier": 3})
	if rec.Code != http.StatusOK {
		t.Fatalf("review: want 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp struct {
		Data struct {
			Status string `json:"status"`
			Tier   int    `json:"tier"`
		} `json:"data"`
	}
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp.Data.Status != "approved" || resp.Data.Tier != 3 {
		t.Fatalf("want approved tier 3, got %+v", resp.Data)
	}
}

// TestBlockedAMLPreventsApproval ensures a sanctions hit blocks the tier.
func TestBlockedAMLPreventsApproval(t *testing.T) {
	r := setupTestService(t, &stubVerifier{
		docScore: 0.9, selfieScore: 0.9, liveness: true,
		aml: &AMLScreenResult{Result: "blocked", RiskScore: 95, SanctionStatus: true},
	})
	userTok := token(t, "user_1", roleUser)
	adminTok := token(t, "admin_1", roleAdmin)
	appID := submitApplication(t, r, userTok)
	hash := "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"

	doRequest(r, http.MethodPost, "/api/v1/kyc/documents", userTok, map[string]interface{}{
		"applicationId": appID, "documentType": "passport", "side": "front", "fileHash": hash,
	})
	doRequest(r, http.MethodPost, "/api/v1/kyc/selfie", userTok, map[string]interface{}{
		"applicationId": appID, "fileHash": hash,
	})
	doRequest(r, http.MethodPost, "/api/v1/kyc/liveness", userTok, map[string]interface{}{
		"applicationId": appID, "challenge": "x",
	})
	doRequest(r, http.MethodPost, "/api/v1/kyc/applications/"+appID+"/aml-check", userTok, nil)

	rec := doRequest(r, http.MethodPost, "/api/v1/kyc/applications/"+appID+"/review", adminTok,
		map[string]interface{}{"applicationId": appID, "approved": true, "tier": 3})
	if rec.Code != http.StatusConflict {
		t.Fatalf("blocked AML approval: want 409, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestDocumentNumberIsHashedAtRest ensures raw document numbers are not stored.
func TestDocumentNumberIsHashedAtRest(t *testing.T) {
	r := setupTestService(t, nil)
	tok := token(t, "user_1", roleUser)

	const docNumber = "AB1234567"
	rec := doRequest(r, http.MethodPost, "/api/v1/kyc/applications", tok, map[string]interface{}{
		"firstName": "Alice", "lastName": "Anderson", "dateOfBirth": "1990-01-01",
		"nationality": "GB", "documentType": "passport", "documentNumber": docNumber,
		"documentCountry": "GB", "address": "1 High St", "city": "London",
		"postalCode": "SW1A 1AA", "country": "GB",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("submit: %d %s", rec.Code, rec.Body.String())
	}

	var stored string
	if err := db.QueryRow("SELECT document_number FROM kyc_applications LIMIT 1").Scan(&stored); err != nil {
		t.Fatalf("query: %v", err)
	}
	if stored == docNumber {
		t.Fatal("document number stored in plaintext")
	}
	if stored != hashPII(piiSecret, docNumber) {
		t.Fatal("document number is not the expected keyed digest")
	}
}

// TestInvalidFileHashRejected ensures the caller cannot skip the hash binding.
func TestInvalidFileHashRejected(t *testing.T) {
	r := setupTestService(t, nil)
	tok := token(t, "user_1", roleUser)
	appID := submitApplication(t, r, tok)

	for _, bad := range []string{"", "nothex", "abc", "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"} {
		rec := doRequest(r, http.MethodPost, "/api/v1/kyc/documents", tok, map[string]interface{}{
			"applicationId": appID, "documentType": "passport", "side": "front", "fileHash": bad,
		})
		if rec.Code == http.StatusOK {
			t.Fatalf("fileHash %q accepted", bad)
		}
	}
}

// TestDuplicateSubmissionRejected ensures one user has one live application.
func TestDuplicateSubmissionRejected(t *testing.T) {
	r := setupTestService(t, nil)
	tok := token(t, "user_1", roleUser)
	submitApplication(t, r, tok)

	rec := doRequest(r, http.MethodPost, "/api/v1/kyc/applications", tok, map[string]interface{}{
		"firstName": "Alice", "lastName": "Anderson", "dateOfBirth": "1990-01-01",
		"nationality": "GB", "documentType": "passport", "documentNumber": "AB1234567",
		"documentCountry": "GB", "address": "1 High St", "city": "London",
		"postalCode": "SW1A 1AA", "country": "GB",
	})
	if rec.Code != http.StatusConflict {
		t.Fatalf("duplicate submit: want 409, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestTokenSignerRoundTrip(t *testing.T) {
	s := newTestSigner(t)

	tok, err := s.sign("user_42", roleAdmin)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	claims, err := s.verify(tok)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if claims.Subject != "user_42" || claims.Role != roleAdmin {
		t.Fatalf("bad claims: %+v", claims)
	}

	// Tampering with the payload must fail verification.
	tampered := "x" + tok[1:]
	if _, err := s.verify(tampered); err == nil {
		t.Fatal("tampered token verified")
	}
}

func TestNewTokenSignerRejectsWeakSecret(t *testing.T) {
	if _, err := newTokenSigner("", time.Hour); err == nil {
		t.Fatal("empty secret accepted")
	}
	if _, err := newTokenSigner("short", time.Hour); err == nil {
		t.Fatal("short secret accepted")
	}
}

func TestIsHexDigest(t *testing.T) {
	if !isHexDigest("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") {
		t.Fatal("valid digest rejected")
	}
	for _, bad := range []string{"", "abc", "zz", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"} {
		if isHexDigest(bad) {
			t.Fatalf("invalid digest %q accepted", bad)
		}
	}
}

// submitApplication creates an application and returns its id.
func submitApplication(t *testing.T, r *gin.Engine, tok string) string {
	t.Helper()
	rec := doRequest(r, http.MethodPost, "/api/v1/kyc/applications", tok, map[string]interface{}{
		"firstName": "Alice", "lastName": "Anderson", "dateOfBirth": "1990-01-01",
		"nationality": "GB", "documentType": "passport", "documentNumber": "AB1234567",
		"documentCountry": "GB", "address": "1 High St", "city": "London",
		"postalCode": "SW1A 1AA", "country": "GB",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("submit application: %d %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Data struct {
			ApplicationID string `json:"applicationId"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return resp.Data.ApplicationID
}

// stubVerifier is a test double for the verification backend.
type stubVerifier struct {
	docScore    float64
	selfieScore float64
	liveness    bool
	aml         *AMLScreenResult
	err         error
}

func (s *stubVerifier) VerifyDocument(context.Context, DocumentCheck) (float64, error) {
	return s.docScore, s.err
}

func (s *stubVerifier) MatchSelfie(context.Context, SelfieCheck) (float64, error) {
	return s.selfieScore, s.err
}

func (s *stubVerifier) CheckLiveness(context.Context, LivenessCheck) (bool, error) {
	return s.liveness, s.err
}

func (s *stubVerifier) ScreenAML(context.Context, AMLScreenRequest) (*AMLScreenResult, error) {
	if s.err != nil {
		return nil, s.err
	}
	if s.aml == nil {
		return &AMLScreenResult{Result: "clear"}, nil
	}
	return s.aml, nil
}
