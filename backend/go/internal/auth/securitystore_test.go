package auth

import (
	"context"
	"errors"
	"testing"

	"tigerex/backend/internal/api"
)

func TestValidateWithdrawalAddressAcceptsKnownFormats(t *testing.T) {
	cases := []struct {
		name    string
		asset   string
		network string
		address string
	}{
		{"evm all lowercase", "USDT", "ethereum", "0x52908400098527886e0f7030069857d2e4169ee7"},
		{"evm eip55 checksummed", "USDT", "bsc", "0x52908400098527886E0F7030069857D2E4169EE7"},
		{"evm eip55 mixed case", "USDT", "polygon", "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"},
		{"btc legacy", "BTC", "bitcoin", "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"},
		{"btc bech32", "BTC", "bitcoin", "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"},
		{"btc p2sh", "BTC", "bitcoin", "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy"},
		{"tron", "USDT", "tron", "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"},
		{"solana", "SOL", "solana", "So11111111111111111111111111111111111111112"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := ValidateWithdrawalAddress(tc.asset, tc.network, tc.address); err != nil {
				t.Fatalf("expected %q on %s to be valid, got %v", tc.address, tc.network, err)
			}
		})
	}
}

func TestValidateWithdrawalAddressRejectsBadInput(t *testing.T) {
	cases := []struct {
		name    string
		asset   string
		network string
		address string
	}{
		{"evm too short", "USDT", "ethereum", "0x52908400098527886e0f7030069857d2e4169e"},
		{"evm missing prefix", "USDT", "ethereum", "52908400098527886e0f7030069857d2e4169ee7"},
		{"evm with sql metacharacters", "USDT", "ethereum", "0x'; DROP TABLE users; --"},
		{"evm non-hex body", "USDT", "ethereum", "0x52908400098527886e0f7030069857d2e4169eez"},
		// A single-character typo in a mixed-case address must fail the EIP-55
		// checksum, otherwise the typo would be stored and funds sent into it.
		{"evm eip55 typo", "USDT", "ethereum", "0x52908400098527886e0F7030069857D2E4169EE7"},
		{"btc base58 checksum typo", "BTC", "bitcoin", "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb"},
		{"btc bech32 checksum typo", "BTC", "bitcoin", "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5"},
		{"btc bech32 with a repeated body", "BTC", "bitcoin", "bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq"},
		{"tron checksum typo", "USDT", "tron", "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u"},
		{"unknown network", "BTC", "dogecoin", "DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L"},
		{"empty address", "BTC", "bitcoin", ""},
		{"empty asset", "", "bitcoin", "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"},
		{"empty network", "BTC", "", "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"},
		{"solana too short", "SOL", "solana", "abc"},
		// Solana keys carry no checksum, so a character outside the base58
		// alphabet is the guard that matters (0, O, I and l are excluded).
		{"solana with a non-base58 character", "SOL", "solana", "5omY7nQeGL4nSqFACz1DfJ4c4V8kGk8xkU7nFjLQh3V0"},
		{"solana far too long", "SOL", "solana", "5omY7nQeGL4nSqFACz1DfJ4c4V8kGk8xkU7nFjLQh3Vtabcdefghijklmnop"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := ValidateWithdrawalAddress(tc.asset, tc.network, tc.address); err == nil {
				t.Fatalf("expected %q on %s to be rejected", tc.address, tc.network)
			}
		})
	}
}

func TestValidateIPRule(t *testing.T) {
	valid := []string{"127.0.0.1", "10.0.0.0/8", "::1", "2001:db8::/32", "203.0.113.7"}
	for _, rule := range valid {
		if err := ValidateIPRule(rule); err != nil {
			t.Errorf("expected %q to be valid, got %v", rule, err)
		}
	}

	invalid := []string{"", "not-an-ip", "10.0.0.0/33", "999.999.999.999", "1.2.3.4; rm -rf /"}
	for _, rule := range invalid {
		if err := ValidateIPRule(rule); err == nil {
			t.Errorf("expected %q to be rejected", rule)
		}
	}
}

func TestValidateIPWhitelistDeduplicatesAndCaps(t *testing.T) {
	got, err := ValidateIPWhitelist([]string{"10.0.0.1", "10.0.0.1", " 10.0.0.2 "})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("expected 2 rules after dedup, got %d (%v)", len(got), got)
	}

	empty, err := ValidateIPWhitelist(nil)
	if err != nil || empty != nil {
		t.Fatalf("expected empty list to be allowed, got %v / %v", empty, err)
	}

	tooMany := make([]string, 51)
	for i := range tooMany {
		tooMany[i] = "10.0.0.1"
	}
	if _, err := ValidateIPWhitelist(tooMany); err == nil {
		t.Fatal("expected more than 50 rules to be rejected")
	}

	if _, err := ValidateIPWhitelist([]string{"10.0.0.1", "bogus"}); err == nil {
		t.Fatal("expected a bogus entry to reject the whole list")
	}
}

func TestValidateAntiPhishingCode(t *testing.T) {
	if err := ValidateAntiPhishingCode(""); err != nil {
		t.Fatalf("empty code should clear the setting, got %v", err)
	}
	if err := ValidateAntiPhishingCode("TGR2024"); err != nil {
		t.Fatalf("expected valid code, got %v", err)
	}
	if err := ValidateAntiPhishingCode("abc"); err == nil {
		t.Fatal("expected a code shorter than 4 characters to be rejected")
	}
	if err := ValidateAntiPhishingCode("012345678901234567890"); err == nil {
		t.Fatal("expected a code longer than 20 characters to be rejected")
	}
	if err := ValidateAntiPhishingCode("ab\x00cd"); err == nil {
		t.Fatal("expected control characters to be rejected")
	}
}

func TestValidateSettings(t *testing.T) {
	good := &api.UserSettings{UserID: "u1", Language: "en", Timezone: "UTC", Theme: "dark", Currency: "USD"}
	if err := ValidateSettings(good); err != nil {
		t.Fatalf("expected settings to be valid, got %v", err)
	}

	bad := []*api.UserSettings{
		{UserID: "", Theme: "dark"},
		{UserID: "u1", Language: "xx"},
		{UserID: "u1", Timezone: "Mars/Olympus"},
		{UserID: "u1", Theme: "neon"},
		{UserID: "u1", Currency: "XYZ"},
	}
	for i, s := range bad {
		if err := ValidateSettings(s); err == nil {
			t.Errorf("case %d: expected settings to be rejected: %+v", i, s)
		}
	}

	if err := ValidateSettings(nil); err == nil {
		t.Fatal("expected nil settings to be rejected")
	}
}

func TestValidateEmailAddress(t *testing.T) {
	if err := ValidateEmailAddress("trader@tigerex.io"); err != nil {
		t.Fatalf("expected valid email, got %v", err)
	}
	for _, bad := range []string{"", "not-an-email", "a@b", "a@b.", "<script>@x.com", "a b@c.com"} {
		if err := ValidateEmailAddress(bad); err == nil {
			t.Errorf("expected %q to be rejected", bad)
		}
	}
}

func TestValidateWebhookURLRejectsNonHTTP(t *testing.T) {
	if err := ValidateWebhookURL("https://hooks.example.com/abc"); err != nil {
		t.Fatalf("expected https URL to be valid, got %v", err)
	}
	if err := ValidateWebhookURL(""); err != nil {
		t.Fatalf("empty URL should clear the setting, got %v", err)
	}
	for _, bad := range []string{"file:///etc/passwd", "javascript:alert(1)", "gopher://x", "https://"} {
		if err := ValidateWebhookURL(bad); err == nil {
			t.Errorf("expected %q to be rejected", bad)
		}
	}
}

func TestMemSecurityStoreAddressLifecycle(t *testing.T) {
	ctx := context.Background()
	store := NewMemSecurityStore()

	empty, err := store.ListWithdrawalAddresses(ctx, "u1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(empty) != 0 {
		t.Fatalf("expected no addresses, got %d", len(empty))
	}

	entry := &api.WithdrawalAddress{
		ID: "a1", UserID: "u1", Asset: "BTC", Network: "bitcoin",
		Address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
	}
	if err := store.AddWithdrawalAddress(ctx, entry); err != nil {
		t.Fatalf("unexpected error adding address: %v", err)
	}

	if err := store.AddWithdrawalAddress(ctx, entry); !errors.Is(err, ErrDuplicateAddress) {
		t.Fatalf("expected ErrDuplicateAddress on duplicate, got %v", err)
	}

	// The same address for a different asset is a distinct entry.
	other := *entry
	other.ID = "a2"
	other.Asset = "USDT"
	if err := store.AddWithdrawalAddress(ctx, &other); err != nil {
		t.Fatalf("unexpected error adding second address: %v", err)
	}

	list, err := store.ListWithdrawalAddresses(ctx, "u1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("expected 2 addresses, got %d", len(list))
	}

	// A different user must not see these entries.
	otherUser, _ := store.ListWithdrawalAddresses(ctx, "u2")
	if len(otherUser) != 0 {
		t.Fatalf("expected no addresses for another user, got %d", len(otherUser))
	}

	if err := store.RemoveWithdrawalAddress(ctx, "u1", "a1"); err != nil {
		t.Fatalf("unexpected error removing address: %v", err)
	}
	if err := store.RemoveWithdrawalAddress(ctx, "u1", "a1"); err == nil {
		t.Fatal("expected removing a missing address to fail")
	}

	remaining, _ := store.ListWithdrawalAddresses(ctx, "u1")
	if len(remaining) != 1 || remaining[0].ID != "a2" {
		t.Fatalf("unexpected remaining addresses: %+v", remaining)
	}
}

func TestMemSecurityStoreVersionAndIPWhitelist(t *testing.T) {
	ctx := context.Background()
	store := NewMemSecurityStore()

	if store.SecurityVersion("u1") != 0 {
		t.Fatal("expected a new user to start at version 0")
	}
	for want := int64(1); want <= 3; want++ {
		got, err := store.BumpSecurityVersion(ctx, "u1")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got != want {
			t.Fatalf("expected version %d, got %d", want, got)
		}
	}

	rules, err := ValidateIPWhitelist([]string{"10.0.0.1", "192.168.0.0/16"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if err := store.SetAPIKeyIPWhitelist(ctx, "u1", "k1", rules); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	got, err := store.GetAPIKeyIPWhitelist(ctx, "u1", "k1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 2 || got[0] != "10.0.0.1" {
		t.Fatalf("unexpected rules: %v", got)
	}

	// Clearing the list removes the restriction.
	if err := store.SetAPIKeyIPWhitelist(ctx, "u1", "k1", nil); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	got, _ = store.GetAPIKeyIPWhitelist(ctx, "u1", "k1")
	if len(got) != 0 {
		t.Fatalf("expected rules to be cleared, got %v", got)
	}
}

func TestMemSecurityStoreUpdateSettings(t *testing.T) {
	ctx := context.Background()
	store := NewMemSecurityStore()

	if err := store.UpdateSettings(ctx, nil); err == nil {
		t.Fatal("expected nil settings to be rejected")
	}
	if err := store.UpdateSettings(ctx, &api.UserSettings{Theme: "dark"}); err == nil {
		t.Fatal("expected settings without a userId to be rejected")
	}

	settings := &api.UserSettings{UserID: "u1", Language: "en", Theme: "light", AntiPhishingCode: "TGR1"}
	if err := store.UpdateSettings(ctx, settings); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	settings.Theme = "dark"
	if err := store.UpdateSettings(ctx, settings); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	stored := store.settings["u1"]
	if stored.Theme != "dark" {
		t.Fatalf("expected the stored theme to be updated, got %q", stored.Theme)
	}
}

func TestAccessTokenCarriesTypeAndSecurityVersion(t *testing.T) {
	svc := NewService(Config{
		JWT: JWTConfig{
			Secret:        []byte("0123456789abcdef0123456789abcdef"),
			AccessExpiry:  60_000_000_000,
			RefreshExpiry: 60_000_000_000,
		},
	})

	user := &api.User{ID: "u1", Email: "trader@tigerex.io", SecurityVersion: 7}
	access, refresh, _, err := svc.GenerateTokenPair(user)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	accessClaims, err := svc.VerifyToken(access)
	if err != nil {
		t.Fatalf("access token should verify: %v", err)
	}
	if accessClaims["type"] != "access" {
		t.Fatalf("expected access token type, got %v", accessClaims["type"])
	}
	if sv, ok := accessClaims["sv"].(float64); !ok || int64(sv) != 7 {
		t.Fatalf("expected security version 7 in access token, got %v", accessClaims["sv"])
	}

	refreshClaims, err := svc.VerifyToken(refresh)
	if err != nil {
		t.Fatalf("refresh token should verify: %v", err)
	}
	if refreshClaims["type"] != "refresh" {
		t.Fatalf("expected refresh token type, got %v", refreshClaims["type"])
	}
}

func TestNormaliseIPList(t *testing.T) {
	got := NormaliseIPList([]string{" 10.0.0.1 ", "10.0.0.1", "", "10.0.0.2"})
	if len(got) != 2 || got[0] != "10.0.0.1" || got[1] != "10.0.0.2" {
		t.Fatalf("unexpected normalised list: %v", got)
	}
}
