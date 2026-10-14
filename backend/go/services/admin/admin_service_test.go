package admin

import "testing"

func TestAdminManagerDoesNotCreateDefaultAdmin(t *testing.T) {
	manager := NewAdminManager()
	if _, err := manager.GetAdminByEmail("admin@tigerex.com"); err == nil {
		t.Fatal("unexpected default administrator exists")
	}
}

func TestCreateAdminHashesPasswordAndLoginVerifiesIt(t *testing.T) {
	manager := NewAdminManager()
	created, err := manager.CreateAdmin(" Admin@Example.com ", "root", "correct horse battery staple", RoleSuperAdmin)
	if err != nil { t.Fatalf("CreateAdmin: %v", err) }
	if created.PasswordHash != "" { t.Fatal("password hash leaked in CreateAdmin result") }
	if _, err := manager.Login("admin@example.com", "wrong password"); err == nil {
		t.Fatal("Login accepted an incorrect password")
	}
	loggedIn, err := manager.Login("ADMIN@example.com", "correct horse battery staple")
	if err != nil { t.Fatalf("Login rejected correct credentials: %v", err) }
	if loggedIn.PasswordHash != "" { t.Fatal("password hash leaked in Login result") }
	if loggedIn.LastLoginAt.IsZero() { t.Fatal("successful login did not update last-login time") }
}

func TestCreateAdminRejectsDuplicateEmailAndWeakPassword(t *testing.T) {
	manager := NewAdminManager()
	if _, err := manager.CreateAdmin("person@example.com", "first", "short", RoleAdmin); err == nil {
		t.Fatal("weak password accepted")
	}
	if _, err := manager.CreateAdmin("person@example.com", "first", "correct horse battery staple", RoleAdmin); err != nil {
		t.Fatalf("CreateAdmin: %v", err)
	}
	if _, err := manager.CreateAdmin(" PERSON@example.com ", "second", "another strong password", RoleAdmin); err == nil {
		t.Fatal("duplicate normalized email accepted")
	}
}

func TestAdminReadsReturnDetachedCopies(t *testing.T) {
	manager := NewAdminManager()
	created, err := manager.CreateAdmin("person@example.com", "person", "correct horse battery staple", RoleAdmin)
	if err != nil { t.Fatal(err) }
	created.Role = RoleSuperAdmin
	created.Permissions = append(created.Permissions, "*")
	loaded, err := manager.GetAdmin(created.ID)
	if err != nil { t.Fatal(err) }
	if loaded.Role != RoleAdmin || len(loaded.Permissions) != 0 {
		t.Fatal("caller mutation changed stored admin")
	}
}
