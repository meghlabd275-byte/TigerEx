// User Model and Authentication - PostgreSQL
package models

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

// User represents a user in the system
type User struct {
	ID                uuid.UUID  `json:"id"`
	Email            string     `json:"email"`
	Username         string     `json:"username"`
	PasswordHash     string     `json:"-"`
	PasswordSalt     string     `json:"-"`
	KYCLevel         int        `json:"kyc_level"`
	Status           string     `json:"status"`
	EmailVerified    bool       `json:"email_verified"`
	PhoneVerified    bool       `json:"phone_verified"`
	TwoFactorEnabled bool       `json:"two_factor_enabled"`
	TwoFactorSecret  string     `json:"-"`
	ReferralCode    string     `json:"referral_code"`
	RiskCategory    string     `json:"risk_category"`
	Jurisdiction    string     `json:"jurisdiction"`
	WalletAddress   string     `json:"wallet_address"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
	LastLoginAt     *time.Time `json:"last_login_at"`
}

// UserProfile represents extended user profile
type UserProfile struct {
	ID                uuid.UUID `json:"id"`
	UserID           uuid.UUID `json:"user_id"`
	FirstName        string    `json:"first_name"`
	LastName         string    `json:"last_name"`
	AvatarURL        string    `json:"avatar_url"`
	LanguagePreference string  `json:"language_preference"`
	Timezone         string    `json:"timezone"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

// Session represents a user session
type Session struct {
	ID           uuid.UUID  `json:"id"`
	UserID       uuid.UUID  `json:"user_id"`
	SessionToken string     `json:"session_token"`
	RefreshToken string     `json:"refresh_token"`
	IPAddress    string     `json:"ip_address"`
	UserAgent    string     `json:"user_agent"`
	ExpiresAt    time.Time `json:"expires_at"`
	CreatedAt    time.Time `json:"created_at"`
	Status       string    `json:"status"`
}

// Wallet represents a user's wallet
type Wallet struct {
	ID          uuid.UUID `json:"id"`
	UserID     uuid.UUID `json:"user_id"`
	Currency   string    `json:"currency"`
	Network    string    `json:"network"`
	WalletType string    `json:"wallet_type"`
	Balance    float64   `json:"balance"`
	Locked     float64   `json:"locked"`
	Available  float64   `json:"available"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// WalletAddress represents a deposit address
type WalletAddress struct {
	ID          uuid.UUID `json:"id"`
	UserID      uuid.UUID `json:"user_id"`
	Currency    string    `json:"currency"`
	Network     string    `json:"network"`
	Address     string    `json:"address"`
	AddressTag  string    `json:"address_tag"`
	IsDefault   bool      `json:"is_default"`
	CreatedAt   time.Time `json:"created_at"`
}

// Transaction represents a wallet transaction
type Transaction struct {
	ID          uuid.UUID  `json:"id"`
	UserID      uuid.UUID  `json:"user_id"`
	Type        string    `json:"type"`
	Currency    string    `json:"currency"`
	Amount      float64   `json:"amount"`
	Fee         float64   `json:"fee"`
	Status      string    `json:"status"`
	TXHash      string    `json:"tx_hash"`
	FromAddress string    `json:"from_address"`
	ToAddress   string    `json:"to_address"`
	Network     string    `json:"network"`
	Memo        string    `json:"memo"`
	CreatedAt   time.Time `json:"created_at"`
	CompletedAt *time.Time `json:"completed_at"`
}

// Errors
var (
	ErrUserNotFound       = errors.New("user not found")
	ErrUserExists         = errors.New("user already exists")
	ErrInvalidPassword    = errors.New("invalid password")
	ErrInvalidToken       = errors.New("invalid token")
	ErrSessionExpired     = errors.New("session expired")
	ErrInvalidCredentials = errors.New("invalid credentials")
)

// GenerateSalt creates a random salt for password hashing
func GenerateSalt() string {
	b := make([]byte, 32)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// HashPassword creates a bcrypt hash of the password
func HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(bytes), err
}

// CheckPassword compares a password with its hash
func CheckPassword(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

// HashPasswordWithSalt creates a SHA256 hash with salt (legacy support)
func HashPasswordWithSalt(password, salt string) string {
	hash := sha256.Sum256([]byte(password + salt))
	return hex.EncodeToString(hash[:])
}

// CreateUser creates a new user in the database
func CreateUser(ctx context.Context, email, username, password string) (*User, error) {
	// Check if user exists
	var exists bool
	err := Pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM users WHERE email = $1 OR username = $2)", email, username).Scan(&exists)
	if err != nil {
		return nil, fmt.Errorf("failed to check user existence: %w", err)
	}
	if exists {
		return nil, ErrUserExists
	}

	// Hash password
	hashedPassword, err := HashPassword(password)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

	// Generate referral code
	referralCode := generateReferralCode()

	// Create user
	var user User
	err = Pool.QueryRow(ctx, `
		INSERT INTO users (email, username, password_hash, password_salt, referral_code, status, kyc_level)
		VALUES ($1, $2, $3, '', $4, 'active', 0)
		RETURNING id, email, username, password_hash, password_salt, kyc_level, status, email_verified, phone_verified, two_factor_enabled, two_factor_secret, referral_code, risk_category, jurisdiction, wallet_address, created_at, updated_at, last_login_at
	`, email, username, hashedPassword, referralCode).Scan(
		&user.ID, &user.Email, &user.Username, &user.PasswordHash, &user.PasswordSalt, &user.KYCLevel, &user.Status, 
		&user.EmailVerified, &user.PhoneVerified, &user.TwoFactorEnabled, &user.TwoFactorSecret, &user.ReferralCode, 
		&user.RiskCategory, &user.Jurisdiction, &user.WalletAddress, &user.CreatedAt, &user.UpdatedAt, &user.LastLoginAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create user: %w", err)
	}

	// Create user profile
	_, err = Pool.Exec(ctx, `
		INSERT INTO user_profiles (user_id, language_preference, timezone)
		VALUES ($1, 'en', 'UTC')
	`, user.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to create user profile: %w", err)
	}

	// Create default wallets for major currencies
	defaultCurrencies := []string{"USDT", "BTC", "ETH", "BNB", "USDC"}
	networks := map[string]string{
		"USDT": "TRC20",
		"BTC":  "BTC",
		"ETH":  "ERC20",
		"BNB":  "BEP20",
		"USDC": "ERC20",
	}

	for _, currency := range defaultCurrencies {
		network := networks[currency]
		if network == "" {
			network = "DEFAULT"
		}
		_, err = Pool.Exec(ctx, `
			INSERT INTO wallets (user_id, currency, network, wallet_type, balance, locked, available)
			VALUES ($1, $2, $3, 'spot', 0, 0, 0)
			ON CONFLICT DO NOTHING
		`, user.ID, currency, network)
		if err != nil {
			return nil, fmt.Errorf("failed to create wallet for %s: %w", currency, err)
		}
	}

	return &user, nil
}

// GetUserByEmail retrieves a user by email
func GetUserByEmail(ctx context.Context, email string) (*User, error) {
	var user User
	err := Pool.QueryRow(ctx, `
		SELECT id, email, username, password_hash, password_salt, kyc_level, status, email_verified, phone_verified, two_factor_enabled, two_factor_secret, referral_code, risk_category, jurisdiction, wallet_address, created_at, updated_at, last_login_at
		FROM users WHERE email = $1
	`, email).Scan(
		&user.ID, &user.Email, &user.Username, &user.PasswordHash, &user.PasswordSalt, &user.KYCLevel, &user.Status,
		&user.EmailVerified, &user.PhoneVerified, &user.TwoFactorEnabled, &user.TwoFactorSecret, &user.ReferralCode,
		&user.RiskCategory, &user.Jurisdiction, &user.WalletAddress, &user.CreatedAt, &user.UpdatedAt, &user.LastLoginAt,
	)
	if err != nil {
		return nil, ErrUserNotFound
	}
	return &user, nil
}

// GetUserByID retrieves a user by ID
func GetUserByID(ctx context.Context, id uuid.UUID) (*User, error) {
	var user User
	err := Pool.QueryRow(ctx, `
		SELECT id, email, username, password_hash, password_salt, kyc_level, status, email_verified, phone_verified, two_factor_enabled, two_factor_secret, referral_code, risk_category, jurisdiction, wallet_address, created_at, updated_at, last_login_at
		FROM users WHERE id = $1
	`, id).Scan(
		&user.ID, &user.Email, &user.Username, &user.PasswordHash, &user.PasswordSalt, &user.KYCLevel, &user.Status,
		&user.EmailVerified, &user.PhoneVerified, &user.TwoFactorEnabled, &user.TwoFactorSecret, &user.ReferralCode,
		&user.RiskCategory, &user.Jurisdiction, &user.WalletAddress, &user.CreatedAt, &user.UpdatedAt, &user.LastLoginAt,
	)
	if err != nil {
		return nil, ErrUserNotFound
	}
	return &user, nil
}

// ValidateCredentials validates user credentials
func ValidateCredentials(ctx context.Context, email, password string) (*User, error) {
	user, err := GetUserByEmail(ctx, email)
	if err != nil {
		return nil, ErrInvalidCredentials
	}

	if !CheckPassword(password, user.PasswordHash) {
		return nil, ErrInvalidCredentials
	}

	if user.Status != "active" {
		return nil, errors.New("account is not active")
	}

	return user, nil
}

// UpdateLastLogin updates the last login timestamp
func UpdateLastLogin(ctx context.Context, userID uuid.UUID) error {
	_, err := Pool.Exec(ctx, `
		UPDATE users SET last_login_at = NOW() WHERE id = $1
	`, userID)
	return err
}

// CreateSession creates a new session for a user
func CreateSession(ctx context.Context, userID uuid.UUID, ipAddress, userAgent string) (*Session, error) {
	sessionToken := generateSessionToken()
	refreshToken := generateSessionToken()
	expiresAt := time.Now().Add(7 * 24 * time.Hour) // 7 days

	var session Session
	err := Pool.QueryRow(ctx, `
		INSERT INTO sessions (user_id, session_token, refresh_token, ip_address, user_agent, expires_at, status)
		VALUES ($1, $2, $3, $4, $5, $6, 'active')
		RETURNING id, user_id, session_token, refresh_token, ip_address, user_agent, expires_at, created_at, status
	`, userID, sessionToken, refreshToken, ipAddress, userAgent, expiresAt).Scan(
		&session.ID, &session.UserID, &session.SessionToken, &session.RefreshToken, 
		&session.IPAddress, &session.UserAgent, &session.ExpiresAt, &session.CreatedAt, &session.Status,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create session: %w", err)
	}

	return &session, nil
}

// GetSession retrieves a session by token
func GetSession(ctx context.Context, token string) (*Session, error) {
	var session Session
	err := Pool.QueryRow(ctx, `
		SELECT id, user_id, session_token, refresh_token, ip_address, user_agent, expires_at, created_at, status
		FROM sessions WHERE session_token = $1 AND status = 'active' AND expires_at > NOW()
	`, token).Scan(
		&session.ID, &session.UserID, &session.SessionToken, &session.RefreshToken,
		&session.IPAddress, &session.UserAgent, &session.ExpiresAt, &session.CreatedAt, &session.Status,
	)
	if err != nil {
		return nil, ErrInvalidToken
	}
	return &session, nil
}

// DeleteSession deletes a session
func DeleteSession(ctx context.Context, token string) error {
	_, err := Pool.Exec(ctx, `
		UPDATE sessions SET status = 'expired' WHERE session_token = $1
	`, token)
	return err
}

// DeleteUserSessions deletes all sessions for a user
func DeleteUserSessions(ctx context.Context, userID uuid.UUID) error {
	_, err := Pool.Exec(ctx, `
		UPDATE sessions SET status = 'expired' WHERE user_id = $1
	`, userID)
	return err
}

// GetUserWallets retrieves all wallets for a user
func GetUserWallets(ctx context.Context, userID uuid.UUID) ([]Wallet, error) {
	rows, err := Pool.Query(ctx, `
		SELECT id, user_id, currency, network, wallet_type, balance, locked, available, created_at, updated_at
		FROM wallets WHERE user_id = $1
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var wallets []Wallet
	for rows.Next() {
		var w Wallet
		if err := rows.Scan(&w.ID, &w.UserID, &w.Currency, &w.Network, &w.WalletType, &w.Balance, &w.Locked, &w.Available, &w.CreatedAt, &w.UpdatedAt); err != nil {
			return nil, err
		}
		wallets = append(wallets, w)
	}
	return wallets, nil
}

// GetWallet gets a specific wallet
func GetWallet(ctx context.Context, userID uuid.UUID, currency, network string) (*Wallet, error) {
	var w Wallet
	err := Pool.QueryRow(ctx, `
		SELECT id, user_id, currency, network, wallet_type, balance, locked, available, created_at, updated_at
		FROM wallets WHERE user_id = $1 AND currency = $2 AND network = $3
	`, userID, currency, network).Scan(&w.ID, &w.UserID, &w.Currency, &w.Network, &w.WalletType, &w.Balance, &w.Locked, &w.Available, &w.CreatedAt, &w.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &w, nil
}

// UpdateWalletBalance updates a wallet's balance
func UpdateWalletBalance(ctx context.Context, walletID uuid.UUID, balance, locked, available float64) error {
	_, err := Pool.Exec(ctx, `
		UPDATE wallets SET balance = $1, locked = $2, available = $3, updated_at = NOW()
		WHERE id = $4
	`, balance, locked, available, walletID)
	return err
}

// CreateTransaction creates a new transaction
func CreateTransaction(ctx context.Context, tx *Transaction) (*Transaction, error) {
	err := Pool.QueryRow(ctx, `
		INSERT INTO transactions (user_id, type, currency, amount, fee, status, tx_hash, from_address, to_address, network, memo)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING id, created_at
	`, tx.UserID, tx.Type, tx.Currency, tx.Amount, tx.Fee, tx.Status, tx.TXHash, tx.FromAddress, tx.ToAddress, tx.Network, tx.Memo).Scan(&tx.ID, &tx.CreatedAt)
	if err != nil {
		return nil, err
	}
	return tx, nil
}

// GetUserTransactions retrieves transactions for a user
func GetUserTransactions(ctx context.Context, userID uuid.UUID, limit int) ([]Transaction, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := Pool.Query(ctx, `
		SELECT id, user_id, type, currency, amount, fee, status, tx_hash, from_address, to_address, network, memo, created_at, completed_at
		FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2
	`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var txs []Transaction
	for rows.Next() {
		var tx Transaction
		if err := rows.Scan(&tx.ID, &tx.UserID, &tx.Type, &tx.Currency, &tx.Amount, &tx.Fee, &tx.Status, &tx.TXHash, &tx.FromAddress, &tx.ToAddress, &tx.Network, &tx.Memo, &tx.CreatedAt, &tx.CompletedAt); err != nil {
			return nil, err
		}
		txs = append(txs, tx)
	}
	return txs, nil
}

// GenerateDepositAddress generates a new deposit address for a user
func GenerateDepositAddress(ctx context.Context, userID uuid.UUID, currency, network string) (*WalletAddress, error) {
	// In production, this would call blockchain node APIs
	// For now, generate a mock address based on currency and network
	address := generateMockAddress(currency, network)

	var walletAddr WalletAddress
	err := Pool.QueryRow(ctx, `
		INSERT INTO wallet_addresses (user_id, currency, network, address, is_default)
		VALUES ($1, $2, $3, $4, 
			NOT EXISTS(SELECT 1 FROM wallet_addresses WHERE user_id = $1 AND currency = $2 AND network = $3)
		)
		RETURNING id, user_id, currency, network, address, address_tag, is_default, created_at
	`, userID, currency, network, address).Scan(
		&walletAddr.ID, &walletAddr.UserID, &walletAddr.Currency, &walletAddr.Network, 
		&walletAddr.Address, &walletAddr.AddressTag, &walletAddr.IsDefault, &walletAddr.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &walletAddr, nil
}

// GetUserAddresses retrieves all addresses for a user
func GetUserAddresses(ctx context.Context, userID uuid.UUID, currency string) ([]WalletAddress, error) {
	rows, err := Pool.Query(ctx, `
		SELECT id, user_id, currency, network, address, address_tag, is_default, created_at
		FROM wallet_addresses WHERE user_id = $1 AND ($2 = '' OR currency = $2)
		ORDER BY is_default DESC, created_at DESC
	`, userID, currency)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var addresses []WalletAddress
	for rows.Next() {
		var addr WalletAddress
		if err := rows.Scan(&addr.ID, &addr.UserID, &addr.Currency, &addr.Network, &addr.Address, &addr.AddressTag, &addr.IsDefault, &addr.CreatedAt); err != nil {
			return nil, err
		}
		addresses = append(addresses, addr)
	}
	return addresses, nil
}

// Helper functions
func generateReferralCode() string {
	b := make([]byte, 8)
	rand.Read(b)
	return "TGR" + hex.EncodeToString(b)[:8]
}

func generateSessionToken() string {
	b := make([]byte, 32)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func generateMockAddress(currency, network string) string {
	prefixes := map[string]string{
		"BTC":  "1",
		"ETH":  "0x",
		"USDT": "T",
		"USDC": "0x",
		"BNB":  "0x",
	}
	prefix := prefixes[currency]
	if prefix == "" {
		prefix = "0x"
	}
	b := make([]byte, 20)
	rand.Read(b)
	return prefix + hex.EncodeToString(b)
}
