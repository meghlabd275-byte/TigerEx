package admin

import (
	"testing"
)

func TestCreateAdminRejectsNilAndDuplicateIdentity(t *testing.T) {
	s := NewService()
	if err := s.CreateAdmin(nil); err == nil {
		t.Fatal("expected nil admin to be rejected")
	}

	first := &AdminUser{ID: "admin-1", Email: " Ops@Example.com ", Password: "test-password", Permissions: []string{"users:read"}}
	if err := s.CreateAdmin(first); err != nil {
		t.Fatalf("CreateAdmin() error = %v", err)
	}
	if first.Email != "ops@example.com" {
		t.Fatalf("email was not normalized: %q", first.Email)
	}
	if err := s.CreateAdmin(&AdminUser{ID: "admin-1", Email: "other@example.com", Password: "test-password"}); err == nil {
		t.Fatal("expected duplicate ID to be rejected")
	}
	if err := s.CreateAdmin(&AdminUser{ID: "admin-2", Email: "OPS@example.com", Password: "test-password"}); err == nil {
		t.Fatal("expected duplicate normalized email to be rejected")
	}
}

func TestCreateAdminDoesNotRetainCallerOwnedPermissions(t *testing.T) {
	s := NewService()
	admin := &AdminUser{ID: "admin-1", Email: "ops@example.com", Password: "test-password", Permissions: []string{"users:read"}}
	if err := s.CreateAdmin(admin); err != nil {
		t.Fatal(err)
	}

	admin.Permissions[0] = "*"
	admin.Email = "attacker@example.com"
	if !s.HasPermission("admin-1", "users:read") {
		t.Fatal("caller mutation changed stored permissions")
	}
	if s.HasPermission("admin-1", "withdrawals:approve") {
		t.Fatal("caller mutation unexpectedly granted wildcard permissions")
	}
	if _, err := s.VerifyAdmin("attacker@example.com", "test-password"); err == nil {
		t.Fatal("caller mutation changed the stored login identity")
	}
	if _, err := s.VerifyAdmin(" OPS@EXAMPLE.COM ", "test-password"); err != nil {
		t.Fatalf("normalized email login failed: %v", err)
	}
}

func TestCloneUserReportCopiesFlags(t *testing.T) {
	source := &UserReport{UserID: "user-1", Flags: []string{"review"}}
	copy := cloneUserReport(source)
	copy.Flags[0] = "changed"
	if source.Flags[0] != "review" {
		t.Fatal("cloneUserReport exposed the original flags slice")
	}
}

func TestAuditLogsAreIndexedFilteredAndDetached(t *testing.T) {
	s := NewService()
	if err := s.FlagUser("admin-1", "user-1", "manual-review"); err != nil { t.Fatal(err) }
	if err := s.FreezeUser("admin-1", "user-1", "policy"); err != nil { t.Fatal(err) }
	if got := s.GetAuditLogs("USER", "user-1", 0); len(got) != 0 { t.Fatalf("zero limit should return no records, got %d", len(got)) }
	logs := s.GetAuditLogs("USER", "user-1", 1)
	if len(logs) != 1 || logs[0].Action != "FREEZE_USER" { t.Fatalf("expected newest user audit record, got %#v", logs) }
	logs[0].Action = "TAMPERED"
	logs[0].Details = "TAMPERED"
	again := s.GetAuditLogs("USER", "user-1", 10)
	if len(again) != 2 { t.Fatalf("expected both indexed user events, got %d", len(again)) }
	for _, log := range again { if log.Action == "TAMPERED" || log.Details == "TAMPERED" { t.Fatal("caller mutation altered stored audit history") } }
	if got := s.GetAuditLogs("ASSET", "user-1", 10); len(got) != 0 { t.Fatalf("target type filter returned mismatched records: %#v", got) }
}

func TestAssetAuditLogsAreIndexed(t *testing.T) {
	s := NewService()
	if err := s.ToggleAsset("admin-1", "BTC", "HALTED"); err != nil { t.Fatal(err) }
	logs := s.GetAuditLogs("ASSET", "BTC", 10)
	if len(logs) != 1 || logs[0].Action != "TOGGLE_ASSET" { t.Fatalf("expected indexed asset audit record, got %#v", logs) }
}

func TestAdminPasswordsAreSaltedHashedAndNotReturned(t *testing.T) {
	s := NewService()
	admin := &AdminUser{ID: "admin-hash", Email: "hash@example.com", Password: "correct horse battery staple"}
	if err := s.CreateAdmin(admin); err != nil { t.Fatal(err) }
	stored := s.admins["admin-hash"].Password
	if stored == admin.Password || len(stored) < 32 || stored[:15] != "pbkdf2-sha256$6" {
		t.Fatalf("password was not stored as a PBKDF2 verifier: %q", stored)
	}
	verified, err := s.VerifyAdmin("hash@example.com", "correct horse battery staple")
	if err != nil { t.Fatalf("valid password rejected: %v", err) }
	if verified.Password != "" { t.Fatal("VerifyAdmin returned stored password material") }
	if _, err := s.VerifyAdmin("hash@example.com", "wrong password"); err == nil { t.Fatal("invalid password accepted") }
	second := &AdminUser{ID: "admin-hash-2", Email: "hash2@example.com", Password: "correct horse battery staple"}
	if err := s.CreateAdmin(second); err != nil { t.Fatal(err) }
	if s.admins["admin-hash-2"].Password == stored { t.Fatal("same password produced identical stored verifiers; salt may be missing") }
}
