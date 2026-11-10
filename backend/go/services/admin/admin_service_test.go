package admin

import (
	"context"
	"errors"
	"testing"
)

func TestAdminManagerDoesNotCreateDefaultAdmin(t *testing.T) {
	manager := NewAdminManager()
	if _, err := manager.GetAdminByEmail("admin@tigerex.com"); err == nil {
		t.Fatal("unexpected default administrator exists")
	}
}

func TestCreateAdminHashesPasswordAndLoginVerifiesIt(t *testing.T) {
	manager := NewAdminManager()
	created, err := manager.CreateAdmin(" Admin@Example.com ", "root", "correct horse battery staple", RoleSuperAdmin)
	if err != nil {
		t.Fatalf("CreateAdmin: %v", err)
	}
	if created.PasswordHash != "" {
		t.Fatal("password hash leaked in CreateAdmin result")
	}
	if _, err := manager.Login("admin@example.com", "wrong password"); err == nil {
		t.Fatal("Login accepted an incorrect password")
	}
	loggedIn, err := manager.Login("ADMIN@example.com", "correct horse battery staple")
	if err != nil {
		t.Fatalf("Login rejected correct credentials: %v", err)
	}
	if loggedIn.PasswordHash != "" {
		t.Fatal("password hash leaked in Login result")
	}
	if loggedIn.LastLoginAt.IsZero() {
		t.Fatal("successful login did not update last-login time")
	}
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
	if err != nil {
		t.Fatal(err)
	}
	created.Role = RoleSuperAdmin
	created.Permissions = append(created.Permissions, "*")
	loaded, err := manager.GetAdmin(created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Role != RoleAdmin || len(loaded.Permissions) != 0 {
		t.Fatal("caller mutation changed stored admin")
	}
}

// fakeDirectory is a stand-in user-data source used to prove the manager
// delegates rather than fabricating values.
type fakeDirectory struct {
	stats   SystemStats
	users   []string
	history map[string]interface{}
}

func (f *fakeDirectory) Stats(ctx context.Context) (SystemStats, error) { return f.stats, nil }
func (f *fakeDirectory) SearchUsers(ctx context.Context, query string) ([]string, error) {
	return f.users, nil
}
func (f *fakeDirectory) GetUserHistory(ctx context.Context, userID string) (map[string]interface{}, error) {
	return f.history, nil
}

func TestAdminUserReadsFailClosedWithoutDirectory(t *testing.T) {
	manager := NewAdminManager()
	ctx := context.Background()

	if _, err := manager.GetSystemStats(ctx); !errors.Is(err, ErrAdminDirectoryUnavailable) {
		t.Fatalf("GetSystemStats returned %v, want ErrAdminDirectoryUnavailable", err)
	}
	if _, err := manager.SearchUsers(ctx, "alice"); !errors.Is(err, ErrAdminDirectoryUnavailable) {
		t.Fatalf("SearchUsers returned %v, want ErrAdminDirectoryUnavailable", err)
	}
	if _, err := manager.GetUserHistory(ctx, "user-1"); !errors.Is(err, ErrAdminDirectoryUnavailable) {
		t.Fatalf("GetUserHistory returned %v, want ErrAdminDirectoryUnavailable", err)
	}
}

func TestAdminSearchRejectsEmptyQuery(t *testing.T) {
	manager := NewAdminManager()
	manager.SetDirectory(&fakeDirectory{})
	if _, err := manager.SearchUsers(context.Background(), "   "); err == nil {
		t.Fatal("empty search query was accepted")
	}
}

func TestAdminUserReadsDelegateToDirectory(t *testing.T) {
	manager := NewAdminManager()
	manager.SetDirectory(&fakeDirectory{
		stats:   SystemStats{TotalUsers: 42, FeeRevenue24h: 1234.5},
		users:   []string{"user-1"},
		history: map[string]interface{}{"user_id": "user-1", "total_trades": 7},
	})
	ctx := context.Background()

	stats, err := manager.GetSystemStats(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if stats.TotalUsers != 42 || stats.FeeRevenue24h != 1234.5 {
		t.Fatalf("stats not delegated: %+v", stats)
	}
	users, err := manager.SearchUsers(ctx, "user")
	if err != nil {
		t.Fatal(err)
	}
	if len(users) != 1 || users[0] != "user-1" {
		t.Fatalf("search not delegated: %v", users)
	}
	history, err := manager.GetUserHistory(ctx, "user-1")
	if err != nil {
		t.Fatal(err)
	}
	if history["total_trades"] != 7 {
		t.Fatalf("history not delegated: %v", history)
	}
}
