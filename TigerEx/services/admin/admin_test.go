package admin

import "testing"

func newService(t *testing.T) *AdminService {
	t.Helper()
	s := NewAdminService()
	if _, err := s.RegisterAdmin("root@tigerex.io", "correct-horse-battery", RoleAdmin); err != nil {
		t.Fatalf("register: %v", err)
	}
	return s
}

func TestRegisterRejectsWeakPassword(t *testing.T) {
	s := NewAdminService()
	if _, err := s.RegisterAdmin("a@b.io", "short", RoleAdmin); err != ErrWeakPassword {
		t.Fatalf("expected ErrWeakPassword, got %v", err)
	}
}

func TestRegisterNormalizesEmailAndRejectsDuplicate(t *testing.T) {
	s := NewAdminService()
	if _, err := s.RegisterAdmin("Admin@TigerEx.io", "correct-horse-battery", RoleAdmin); err != nil {
		t.Fatalf("register: %v", err)
	}
	if _, err := s.RegisterAdmin("admin@tigerex.io", "correct-horse-battery", RoleAdmin); err == nil {
		t.Fatal("expected duplicate registration to fail")
	}
	if _, _, err := s.Login("admin@tigerex.io", "correct-horse-battery", "127.0.0.1"); err != nil {
		t.Fatalf("login with normalized email: %v", err)
	}
}

func TestLoginRejectsWrongPassword(t *testing.T) {
	s := newService(t)
	if _, _, err := s.Login("root@tigerex.io", "wrong-password", "127.0.0.1"); err != ErrInvalidCredentials {
		t.Fatalf("expected ErrInvalidCredentials, got %v", err)
	}
}

// The role table grants namespaced wildcards such as "users:*"; without wildcard
// matching every non-super role was denied every action it was meant to allow.
func TestNamespacedWildcardAuthorizesAction(t *testing.T) {
	s := newService(t)
	admin, _, err := s.Login("root@tigerex.io", "correct-horse-battery", "127.0.0.1")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if !s.HasPermission(admin.ID, "users:suspend") {
		t.Fatal("users:* should authorize users:suspend")
	}
	if !s.HasPermission(admin.ID, "withdrawals:approve") {
		t.Fatal("withdrawals:* should authorize withdrawals:approve")
	}
	if s.HasPermission(admin.ID, "dex:manage") {
		t.Fatal("the admin's grants must not authorize an unrelated namespace")
	}
}

func TestSuspendUserRequiresPermission(t *testing.T) {
	s := NewAdminService()
	viewer, err := s.RegisterAdmin("viewer@tigerex.io", "correct-horse-battery", RoleViewer)
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	if err := s.SuspendUser(viewer.ID, "user-1", "fraud", "127.0.0.1"); err != ErrPermissionDenied {
		t.Fatalf("viewer must be denied, got %v", err)
	}
}

func TestSessionRevokedOnLogout(t *testing.T) {
	s := newService(t)
	_, token, err := s.Login("root@tigerex.io", "correct-horse-battery", "127.0.0.1")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if _, err := s.ValidateSession(token); err != nil {
		t.Fatalf("valid session rejected: %v", err)
	}
	s.Logout(token)
	if _, err := s.ValidateSession(token); err != ErrAdminNotFound {
		t.Fatalf("logged-out session still valid: %v", err)
	}
}
