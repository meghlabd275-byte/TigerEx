package main

import (
	"testing"
)

func TestAdminServiceHasNoPublicDefaultCredentials(t *testing.T) {
	t.Setenv("TIGEREX_BOOTSTRAP_ADMIN_EMAIL", "")
	t.Setenv("TIGEREX_BOOTSTRAP_ADMIN_PASSWORD", "")
	service := NewAdminService()
	if len(service.admins) != 0 {
		t.Fatal("admin service created an administrator without deployment credentials")
	}
	if _, _, err := service.Login("admin@tigerex.com", "admin123", "127.0.0.1"); err == nil {
		t.Fatal("legacy default credentials unexpectedly authenticated")
	}
	if service.settings["trading_enabled"].Value != "false" ||
		service.settings["withdrawal_enabled"].Value != "false" ||
		service.settings["maintenance_mode"].Value != "true" {
		t.Fatal("unconfigured trading must start disabled")
	}
}

func TestAdminServiceBootstrapRequiresStrongExplicitPassword(t *testing.T) {
	t.Setenv("TIGEREX_BOOTSTRAP_ADMIN_EMAIL", "operator@example.com")
	t.Setenv("TIGEREX_BOOTSTRAP_ADMIN_PASSWORD", "short")
	service := NewAdminService()
	if len(service.admins) != 0 {
		t.Fatal("weak bootstrap password was accepted")
	}

	t.Setenv("TIGEREX_BOOTSTRAP_ADMIN_PASSWORD", "strong bootstrap password 2026")
	service = NewAdminService()
	admin, token, err := service.Login("operator@example.com", "strong bootstrap password 2026", "127.0.0.1")
	if err != nil { t.Fatalf("configured bootstrap admin could not log in: %v", err) }
	if admin.ID == "" || token == "" { t.Fatal("login did not create an authenticated session") }
	if _, err := service.ValidateSession(token); err != nil { t.Fatalf("session did not validate: %v", err) }
}
