package auth

import (
	"context"
	"errors"
	"net"
	"net/mail"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/btcsuite/btcd/btcutil/base58"
	"github.com/btcsuite/btcd/btcutil/bech32"
	"golang.org/x/crypto/sha3"

	"tigerex/backend/internal/api"
)

// SecurityStore persists account-security settings: anti-phishing code,
// withdrawal address whitelist, and API-key IP allowlist.
//
// These settings decide whether funds can leave the exchange, so they are
// stored durably rather than in process memory. Every write also bumps the
// user's SecurityVersion, which invalidates sessions issued before the change.
type SecurityStore interface {
	UpdateSettings(ctx context.Context, settings *api.UserSettings) error

	ListWithdrawalAddresses(ctx context.Context, userID string) ([]api.WithdrawalAddress, error)
	AddWithdrawalAddress(ctx context.Context, entry *api.WithdrawalAddress) error
	RemoveWithdrawalAddress(ctx context.Context, userID, addressID string) error

	SetAPIKeyIPWhitelist(ctx context.Context, userID, keyID string, cidrs []string) error
	GetAPIKeyIPWhitelist(ctx context.Context, userID, keyID string) ([]string, error)

	BumpSecurityVersion(ctx context.Context, userID string) (int64, error)
}

// WithSecurityStore returns the service with a security-settings store
// attached.
func (s *Service) WithSecurityStore(store SecurityStore) *Service {
	s.securityStore = store
	return s
}

// SecurityStore returns the configured security store, or nil.
func (s *Service) SecurityStore() SecurityStore { return s.securityStore }

var (
	// ErrInvalidAddress is returned for a withdrawal address that fails format
	// validation.
	ErrInvalidAddress = errors.New("invalid withdrawal address")
	// ErrAddressNotWhitelisted is returned when a withdrawal targets an address
	// the user has not approved.
	ErrAddressNotWhitelisted = errors.New("withdrawal address is not whitelisted")
	// ErrInvalidIPRule is returned for a malformed IP or CIDR entry.
	ErrInvalidIPRule = errors.New("invalid IP or CIDR")
	// ErrDuplicateAddress is returned when an address is already whitelisted.
	ErrDuplicateAddress = errors.New("address is already whitelisted")
)

// Address validation uses the real address codecs rather than character
// patterns. A pattern that only checks length and charset accepts any
// single-character typo, and a typo in a withdrawal address sends funds to an
// address nobody controls. Each codec below verifies the checksum the chain
// itself uses, so a mistyped address is rejected before it is ever stored.
var evmNetworks = map[string]bool{
	"ethereum":  true,
	"bsc":       true,
	"polygon":   true,
	"arbitrum":  true,
	"optimism":  true,
	"base":      true,
	"avalanche": true,
}

// ValidateWithdrawalAddress checks an address with the codec used by its
// network, including the network's checksum.
func ValidateWithdrawalAddress(asset, network, address string) error {
	if strings.TrimSpace(asset) == "" {
		return errors.New("asset is required")
	}
	network = strings.ToLower(strings.TrimSpace(network))
	if network == "" {
		return errors.New("network is required")
	}

	address = strings.TrimSpace(address)
	if address == "" {
		return ErrInvalidAddress
	}

	switch {
	case evmNetworks[network]:
		if !isValidEVMAddress(address) {
			return ErrInvalidAddress
		}
	case network == "bitcoin":
		if !isValidBitcoinAddress(address) {
			return ErrInvalidAddress
		}
	case network == "tron":
		if !isValidTronAddress(address) {
			return ErrInvalidAddress
		}
	case network == "solana":
		if !isValidSolanaAddress(address) {
			return ErrInvalidAddress
		}
	default:
		// A network with no registered codec is rejected outright, so a new
		// chain cannot be enabled without an address rule.
		return errors.New("network is not supported")
	}
	return nil
}

// isValidEVMAddress validates a 20-byte hex address and enforces EIP-55 when
// the address uses mixed case. All-lowercase and all-uppercase forms carry no
// checksum and are accepted, matching the behaviour of every EVM wallet.
func isValidEVMAddress(address string) bool {
	if len(address) != 42 || !strings.HasPrefix(address, "0x") {
		return false
	}
	body := address[2:]
	for i := 0; i < len(body); i++ {
		if !isHexDigit(body[i]) {
			return false
		}
	}
	if body == strings.ToLower(body) || body == strings.ToUpper(body) {
		return true
	}

	hasher := sha3.NewLegacyKeccak256()
	hasher.Write([]byte(strings.ToLower(body)))
	sum := hasher.Sum(nil)

	for i := 0; i < len(body); i++ {
		c := body[i]
		if c >= '0' && c <= '9' {
			continue
		}
		// The high nibble of the hash byte governs the first of each pair of
		// characters, the low nibble the second.
		nibble := sum[i/2] & 0x0f
		if i%2 == 0 {
			nibble = sum[i/2] >> 4
		}
		if nibble >= 8 {
			if c < 'A' || c > 'F' {
				return false
			}
		} else if c < 'a' || c > 'f' {
			return false
		}
	}
	return true
}

func isHexDigit(c byte) bool {
	return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')
}

// isValidBitcoinAddress accepts base58check addresses (P2PKH version 0x00,
// P2SH version 0x05) and bech32/bech32m segwit addresses on the "bc" prefix.
func isValidBitcoinAddress(address string) bool {
	if strings.HasPrefix(strings.ToLower(address), "bc1") {
		hrp, data, err := bech32.Decode(strings.ToLower(address))
		if err != nil || hrp != "bc" {
			return false
		}
		// A segwit program is 20 to 32 bytes, which is 32 to 52 five-bit
		// groups after the version byte.
		return len(data) >= 32 && len(data) <= 52
	}

	payload, version, err := base58.CheckDecode(address)
	if err != nil {
		return false
	}
	if version != 0x00 && version != 0x05 {
		return false
	}
	return len(payload) == 20
}

// isValidTronAddress validates a base58check address whose version byte is
// 0x41 and whose payload is a 20-byte hash.
func isValidTronAddress(address string) bool {
	payload, version, err := base58.CheckDecode(address)
	if err != nil {
		return false
	}
	return version == 0x41 && len(payload) == 20
}

// isValidSolanaAddress validates a base58-encoded 32-byte ed25519 public key.
// Solana addresses carry no checksum, so the decoded length is the only guard.
func isValidSolanaAddress(address string) bool {
	if len(address) < 32 || len(address) > 44 {
		return false
	}
	// Decode returns an empty slice when the input contains a character
	// outside the base58 alphabet, so the length check also rejects it.
	return len(base58.Decode(address)) == 32
}

// ValidateIPRule accepts a single IP address or a CIDR block.
func ValidateIPRule(rule string) error {
	rule = strings.TrimSpace(rule)
	if rule == "" {
		return ErrInvalidIPRule
	}
	if strings.Contains(rule, "/") {
		if _, _, err := net.ParseCIDR(rule); err != nil {
			return ErrInvalidIPRule
		}
		return nil
	}
	if net.ParseIP(rule) == nil {
		return ErrInvalidIPRule
	}
	return nil
}

// ValidateIPWhitelist validates every entry and returns them normalised. An
// empty list is allowed and means "no IP restriction".
func ValidateIPWhitelist(rules []string) ([]string, error) {
	if len(rules) == 0 {
		return nil, nil
	}
	if len(rules) > 50 {
		return nil, errors.New("at most 50 IP rules are allowed")
	}

	out := make([]string, 0, len(rules))
	seen := map[string]bool{}
	for _, rule := range rules {
		if err := ValidateIPRule(rule); err != nil {
			return nil, err
		}
		normalised := strings.TrimSpace(rule)
		if seen[normalised] {
			continue
		}
		seen[normalised] = true
		out = append(out, normalised)
	}
	return out, nil
}

// ValidateAntiPhishingCode enforces the published format: 4 to 20 printable
// characters. It is shown in every outbound email so the user can tell a real
// message from a phishing attempt.
func ValidateAntiPhishingCode(code string) error {
	code = strings.TrimSpace(code)
	if code == "" {
		return nil
	}
	if len(code) < 4 || len(code) > 20 {
		return errors.New("anti-phishing code must be between 4 and 20 characters")
	}
	for _, r := range code {
		if r < 0x20 || r == 0x7f {
			return errors.New("anti-phishing code must not contain control characters")
		}
	}
	return nil
}

// ValidateSettings validates the mutable display and security preferences.
func ValidateSettings(s *api.UserSettings) error {
	if s == nil {
		return errors.New("settings are required")
	}
	if s.UserID == "" {
		return errors.New("userId is required")
	}
	if s.Language != "" && !validLanguage(s.Language) {
		return errors.New("unsupported language")
	}
	if s.Timezone != "" && !validTimezone(s.Timezone) {
		return errors.New("unsupported timezone")
	}
	if s.Theme != "" && s.Theme != "dark" && s.Theme != "light" && s.Theme != "system" {
		return errors.New("theme must be dark, light, or system")
	}
	if s.Currency != "" && !validCurrency(s.Currency) {
		return errors.New("unsupported currency")
	}
	return ValidateAntiPhishingCode(s.AntiPhishingCode)
}

func validLanguage(lang string) bool {
	switch strings.ToLower(strings.TrimSpace(lang)) {
	case "en", "bn", "zh", "es", "fr", "de", "ja", "ko", "ru", "ar", "hi", "pt", "tr", "vi", "id", "th":
		return true
	}
	return false
}

func validTimezone(tz string) bool {
	if tz == "UTC" {
		return true
	}
	_, err := time.LoadLocation(tz)
	return err == nil
}

func validCurrency(cur string) bool {
	switch strings.ToUpper(strings.TrimSpace(cur)) {
	case "USD", "EUR", "GBP", "JPY", "BDT", "INR", "AUD", "CAD", "CHF", "CNY", "SGD", "HKD", "KRW", "BRL", "TRY", "AED":
		return true
	}
	return false
}

// ValidateEmailAddress parses an address with the standard library parser,
// which is stricter than a hand-rolled regexp.
func ValidateEmailAddress(address string) error {
	address = strings.TrimSpace(address)
	if address == "" {
		return errors.New("email is required")
	}
	if len(address) > 254 {
		return errors.New("email is too long")
	}
	parsed, err := mail.ParseAddress(address)
	if err != nil {
		return errors.New("invalid email address")
	}
	if parsed.Address != address {
		return errors.New("invalid email address")
	}
	at := strings.LastIndex(address, "@")
	if at < 0 || !strings.Contains(address[at+1:], ".") {
		return errors.New("invalid email address")
	}
	return nil
}

// ValidateWebhookURL restricts outbound webhooks to http and https. Without
// this check a user could register file:// or gopher:// and turn the exchange
// into a request forwarder.
func ValidateWebhookURL(raw string) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	u, err := url.Parse(raw)
	if err != nil {
		return errors.New("invalid webhook URL")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return errors.New("webhook URL must use http or https")
	}
	if u.Host == "" {
		return errors.New("webhook URL must include a host")
	}
	return nil
}

// ---------------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------------

// MemSecurityStore is the in-memory SecurityStore used by tests and
// single-process deployments.
type MemSecurityStore struct {
	settings  map[string]*api.UserSettings
	addresses map[string][]api.WithdrawalAddress
	ipRules   map[string][]string
	versions  map[string]int64
}

// NewMemSecurityStore returns an empty in-memory security store.
func NewMemSecurityStore() *MemSecurityStore {
	return &MemSecurityStore{
		settings:  map[string]*api.UserSettings{},
		addresses: map[string][]api.WithdrawalAddress{},
		ipRules:   map[string][]string{},
		versions:  map[string]int64{},
	}
}

func (m *MemSecurityStore) UpdateSettings(_ context.Context, settings *api.UserSettings) error {
	if settings == nil || settings.UserID == "" {
		return errors.New("settings and userId are required")
	}
	clone := *settings
	m.settings[settings.UserID] = &clone
	return nil
}

func (m *MemSecurityStore) ListWithdrawalAddresses(_ context.Context, userID string) ([]api.WithdrawalAddress, error) {
	out := make([]api.WithdrawalAddress, len(m.addresses[userID]))
	copy(out, m.addresses[userID])
	return out, nil
}

func (m *MemSecurityStore) AddWithdrawalAddress(_ context.Context, entry *api.WithdrawalAddress) error {
	if entry == nil || entry.UserID == "" {
		return errors.New("entry and userId are required")
	}
	for _, existing := range m.addresses[entry.UserID] {
		if existing.Asset == entry.Asset && existing.Address == entry.Address {
			return ErrDuplicateAddress
		}
	}
	m.addresses[entry.UserID] = append(m.addresses[entry.UserID], *entry)
	return nil
}

func (m *MemSecurityStore) RemoveWithdrawalAddress(_ context.Context, userID, addressID string) error {
	entries := m.addresses[userID]
	for i, existing := range entries {
		if existing.ID == addressID {
			m.addresses[userID] = append(entries[:i], entries[i+1:]...)
			return nil
		}
	}
	return errors.New("address not found")
}

func (m *MemSecurityStore) SetAPIKeyIPWhitelist(_ context.Context, _, keyID string, cidrs []string) error {
	clone := make([]string, len(cidrs))
	copy(clone, cidrs)
	m.ipRules[keyID] = clone
	return nil
}

func (m *MemSecurityStore) GetAPIKeyIPWhitelist(_ context.Context, _, keyID string) ([]string, error) {
	out := make([]string, len(m.ipRules[keyID]))
	copy(out, m.ipRules[keyID])
	return out, nil
}

func (m *MemSecurityStore) BumpSecurityVersion(_ context.Context, userID string) (int64, error) {
	m.versions[userID]++
	return m.versions[userID], nil
}

// SecurityVersion returns the current version for a user. It is used by tests.
func (m *MemSecurityStore) SecurityVersion(userID string) int64 { return m.versions[userID] }

// SortedWhitelistedAddresses returns a user's addresses sorted by asset then
// address, for deterministic output in tests and admin screens.
func (m *MemSecurityStore) SortedWhitelistedAddresses(userID string) []api.WithdrawalAddress {
	out := make([]api.WithdrawalAddress, len(m.addresses[userID]))
	copy(out, m.addresses[userID])
	sort.Slice(out, func(i, j int) bool {
		if out[i].Asset != out[j].Asset {
			return out[i].Asset < out[j].Asset
		}
		return out[i].Address < out[j].Address
	})
	return out
}

var _ SecurityStore = (*MemSecurityStore)(nil)
