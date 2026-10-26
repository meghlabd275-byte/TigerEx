package rbac

import (
	"context"
	"strings"
	"testing"
)

// newTestService builds an RBAC service with a usable signing key.
func newTestService(t *testing.T) *RBACService {
	t.Helper()
	return NewRBACService(strings.Repeat("s", 32), RBACConfig{})
}

// Admin passwords must not be stored as a bare SHA-256, which is fast and
// unsalted.
func TestAdminPasswordUsesBcrypt(t *testing.T) {
	s := newTestService(t)

	admin := &Admin{
		Email:        "ops@tigerex.example",
		PasswordHash: "Correct1Horse",
		RoleID:       "role_super_admin",
	}
	if err := s.RegisterAdmin(context.Background(), admin, "system"); err != nil {
		t.Fatalf("register failed: %v", err)
	}

	if !strings.HasPrefix(admin.PasswordHash, "$2") {
		t.Fatalf("expected a bcrypt hash, got %q", admin.PasswordHash)
	}
	if len(admin.PasswordHash) < 50 {
		t.Fatalf("bcrypt hash looks too short: %q", admin.PasswordHash)
	}

	// The plaintext must not be recoverable from the hash.
	if strings.Contains(admin.PasswordHash, "Correct1Horse") {
		t.Fatal("the hash must not contain the plaintext")
	}

	if !s.verifyPassword("Correct1Horse", admin.PasswordHash) {
		t.Fatal("the correct password must verify")
	}
	if s.verifyPassword("wrong", admin.PasswordHash) {
		t.Fatal("a wrong password must not verify")
	}
}

// Two admins with the same password must get different hashes, which proves
// the salt is per-password.
func TestAdminPasswordHashesAreSalted(t *testing.T) {
	s := newTestService(t)
	ctx := context.Background()

	first := &Admin{Email: "a@tigerex.example", PasswordHash: "Same1Password", RoleID: "role_super_admin"}
	second := &Admin{Email: "b@tigerex.example", PasswordHash: "Same1Password", RoleID: "role_super_admin"}
	if err := s.RegisterAdmin(ctx, first, "system"); err != nil {
		t.Fatalf("register failed: %v", err)
	}
	if err := s.RegisterAdmin(ctx, second, "system"); err != nil {
		t.Fatalf("register failed: %v", err)
	}

	if first.PasswordHash == second.PasswordHash {
		t.Fatal("identical passwords must not produce identical hashes")
	}
}

// The hardcoded "admin_super" id must no longer grant super admin rights.
func TestSuperAdminIsNotABackdoor(t *testing.T) {
	s := newTestService(t)
	ctx := context.Background()

	// Nobody with that id is registered, so it must not be super admin.
	if s.isSuperAdmin("admin_super") {
		t.Fatal("an unregistered id must not be super admin")
	}

	// A real super admin is recognised.
	superAdmin := &Admin{
		Email:        "root@tigerex.example",
		PasswordHash: "Correct1Horse",
		RoleID:       "role_super_admin",
	}
	if err := s.RegisterAdmin(ctx, superAdmin, "system"); err != nil {
		t.Fatalf("register failed: %v", err)
	}
	if !s.isSuperAdmin(superAdmin.ID) {
		t.Fatal("a registered super admin must be recognised")
	}

	// A deactivated admin loses the privilege.
	superAdmin.IsActive = false
	if s.isSuperAdmin(superAdmin.ID) {
		t.Fatal("an inactive admin must not be super admin")
	}
}

// Permissions must be denied for unknown and inactive admins.
func TestHasPermissionDeniesUnknownAndInactive(t *testing.T) {
	s := newTestService(t)
	ctx := context.Background()

	if s.HasPermission(ctx, "no-such-admin", PermissionUserRead) {
		t.Fatal("an unknown admin must have no permissions")
	}

	admin := &Admin{
		Email:        "support@tigerex.example",
		PasswordHash: "Correct1Horse",
		RoleID:       "role_support",
	}
	if err := s.RegisterAdmin(ctx, admin, "system"); err != nil {
		t.Fatalf("register failed: %v", err)
	}
	if !s.HasPermission(ctx, admin.ID, PermissionUserRead) {
		t.Fatal("the support role must be able to read users")
	}
	if s.HasPermission(ctx, admin.ID, PermissionWithdrawApprove) {
		t.Fatal("the support role must not be able to withdraw treasury funds")
	}

	admin.IsActive = false
	if s.HasPermission(ctx, admin.ID, PermissionUserRead) {
		t.Fatal("an inactive admin must have no permissions")
	}
}

// A correct password authenticates and a wrong one does not.
func TestAuthenticateAdmin(t *testing.T) {
	s := newTestService(t)
	ctx := context.Background()

	admin := &Admin{
		Email:        "ops@tigerex.example",
		PasswordHash: "Correct1Horse",
		RoleID:       "role_super_admin",
	}
	if err := s.RegisterAdmin(ctx, admin, "system"); err != nil {
		t.Fatalf("register failed: %v", err)
	}

	if _, err := s.AuthenticateAdmin(ctx, "ops@tigerex.example", "wrong", "1.2.3.4"); err == nil {
		t.Fatal("a wrong password must not authenticate")
	}

	session, err := s.AuthenticateAdmin(ctx, "ops@tigerex.example", "Correct1Horse", "1.2.3.4")
	if err != nil {
		t.Fatalf("the correct password must authenticate: %v", err)
	}
	if session == nil || session.Token == "" {
		t.Fatal("a session token must be issued")
	}

	// The issued session must validate.
	if _, err := s.ValidateSession(ctx, session.Token); err != nil {
		t.Fatalf("the issued session must validate: %v", err)
	}
	if _, err := s.ValidateSession(ctx, "not-a-session"); err == nil {
		t.Fatal("an unknown token must not validate")
	}
}

// Repeated failures must lock the account.
func TestAccountLocksAfterMaxAttempts(t *testing.T) {
	s := newTestService(t)
	ctx := context.Background()

	admin := &Admin{
		Email:        "ops@tigerex.example",
		PasswordHash: "Correct1Horse",
		RoleID:       "role_super_admin",
	}
	if err := s.RegisterAdmin(ctx, admin, "system"); err != nil {
		t.Fatalf("register failed: %v", err)
	}

	for i := 0; i < s.config.MaxLoginAttempts; i++ {
		if _, err := s.AuthenticateAdmin(ctx, "ops@tigerex.example", "wrong", "1.2.3.4"); err == nil {
			t.Fatal("a wrong password must not authenticate")
		}
	}

	// Even the correct password is refused while locked.
	if _, err := s.AuthenticateAdmin(ctx, "ops@tigerex.example", "Correct1Horse", "1.2.3.4"); err == nil {
		t.Fatal("a locked account must refuse the correct password")
	}
}

// Failed logins must be recorded in the audit log.
func TestFailedLoginIsAudited(t *testing.T) {
	s := newTestService(t)
	ctx := context.Background()

	admin := &Admin{
		Email:        "ops@tigerex.example",
		PasswordHash: "Correct1Horse",
		RoleID:       "role_super_admin",
	}
	if err := s.RegisterAdmin(ctx, admin, "system"); err != nil {
		t.Fatalf("register failed: %v", err)
	}

	if _, err := s.AuthenticateAdmin(ctx, "ops@tigerex.example", "wrong", "1.2.3.4"); err == nil {
		t.Fatal("a wrong password must not authenticate")
	}

	logs := s.GetAuditLogs(ctx, admin.ID, 10)
	found := false
	for _, l := range logs {
		if l.Action == "login_failed" && l.Result == "failure" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("the failed login must appear in the audit log")
	}
}
