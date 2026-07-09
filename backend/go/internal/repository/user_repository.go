package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"tigerex/internal/models"
)

var (
	ErrUserNotFound       = errors.New("user not found")
	ErrUserAlreadyExists  = errors.New("user already exists")
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrUserLocked         = errors.New("user account is locked")
	ErrSessionNotFound    = errors.New("session not found")
	ErrSessionExpired     = errors.New("session expired")
	ErrInvalidToken       = errors.New("invalid token")
	ErrTokenExpired       = errors.New("token expired")
	ErrRefreshTokenRevoked = errors.New("refresh token has been revoked")
)

type UserRepository struct {
	db *pgxpool.Pool
}

func NewUserRepository(db *pgxpool.Pool) *UserRepository {
	return &UserRepository{db: db}
}

func (r *UserRepository) Create(ctx context.Context, user *models.User) error {
	query := `
		INSERT INTO users (
			id, email, username, password_hash, phone, country, kyc_level, status,
			risk_level, referral_code, referred_by, deposit_enabled, withdrawal_enabled,
			trading_enabled, otp_secret, otp_enabled, anti_phishing_code,
			created_at, updated_at
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
			$18, $19
		)
	`

	now := time.Now()
	if user.ID == uuid.Nil {
		user.ID = uuid.New()
	}
	if user.CreatedAt.IsZero() {
		user.CreatedAt = now
	}
	user.UpdatedAt = now
	if user.Status == "" {
		user.Status = models.UserStatusPending
	}
	if user.KYCLevel == "" {
		user.KYCLevel = models.KYCLevelNone
	}
	if user.Country == "" {
		user.Country = "USA"
	}
	user.DepositEnabled = true
	user.WithdrawalEnabled = true
	user.TradingEnabled = true
	user.OTPEnabled = false

	_, err := r.db.Exec(ctx, query,
		user.ID, user.Email, user.Username, user.PasswordHash, user.Phone, user.Country,
		user.KYCLevel, user.Status, user.RiskLevel, user.ReferralCode, user.ReferredBy,
		user.DepositEnabled, user.WithdrawalEnabled, user.TradingEnabled, user.OTPSecret,
		user.OTPEnabled, user.AntiPhishingCode, user.CreatedAt, user.UpdatedAt,
	)

	if err != nil {
		return fmt.Errorf("failed to create user: %w", err)
	}

	return nil
}

func (r *UserRepository) GetByID(ctx context.Context, id uuid.UUID) (*models.User, error) {
	query := `
		SELECT id, email, username, password_hash, phone, country, kyc_level, status,
			risk_level, referral_code, referred_by, deposit_enabled, withdrawal_enabled,
			trading_enabled, otp_secret, otp_enabled, anti_phishing_code,
			created_at, updated_at, last_login_at, last_login_ip, email_verified_at,
			phone_verified_at, banned_at, ban_reason
		FROM users
		WHERE id = $1
	`

	var user models.User
	err := r.db.QueryRow(ctx, query, id).Scan(
		&user.ID, &user.Email, &user.Username, &user.PasswordHash, &user.Phone, &user.Country,
		&user.KYCLevel, &user.Status, &user.RiskLevel, &user.ReferralCode, &user.ReferredBy,
		&user.DepositEnabled, &user.WithdrawalEnabled, &user.TradingEnabled, &user.OTPSecret,
		&user.OTPEnabled, &user.AntiPhishingCode, &user.CreatedAt, &user.UpdatedAt,
		&user.LastLoginAt, &user.LastLoginIP, &user.EmailVerifiedAt, &user.PhoneVerifiedAt,
		&user.BannedAt, &user.BanReason,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, fmt.Errorf("failed to get user by id: %w", err)
	}

	return &user, nil
}

func (r *UserRepository) GetByEmail(ctx context.Context, email string) (*models.User, error) {
	query := `
		SELECT id, email, username, password_hash, phone, country, kyc_level, status,
			risk_level, referral_code, referred_by, deposit_enabled, withdrawal_enabled,
			trading_enabled, otp_secret, otp_enabled, anti_phishing_code,
			created_at, updated_at, last_login_at, last_login_ip, email_verified_at,
			phone_verified_at, banned_at, ban_reason
		FROM users
		WHERE email = $1
	`

	var user models.User
	err := r.db.QueryRow(ctx, query, email).Scan(
		&user.ID, &user.Email, &user.Username, &user.PasswordHash, &user.Phone, &user.Country,
		&user.KYCLevel, &user.Status, &user.RiskLevel, &user.ReferralCode, &user.ReferredBy,
		&user.DepositEnabled, &user.WithdrawalEnabled, &user.TradingEnabled, &user.OTPSecret,
		&user.OTPEnabled, &user.AntiPhishingCode, &user.CreatedAt, &user.UpdatedAt,
		&user.LastLoginAt, &user.LastLoginIP, &user.EmailVerifiedAt, &user.PhoneVerifiedAt,
		&user.BannedAt, &user.BanReason,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, fmt.Errorf("failed to get user by email: %w", err)
	}

	return &user, nil
}

func (r *UserRepository) GetByUsername(ctx context.Context, username string) (*models.User, error) {
	query := `
		SELECT id, email, username, password_hash, phone, country, kyc_level, status,
			risk_level, referral_code, referred_by, deposit_enabled, withdrawal_enabled,
			trading_enabled, otp_secret, otp_enabled, anti_phishing_code,
			created_at, updated_at, last_login_at, last_login_ip, email_verified_at,
			phone_verified_at, banned_at, ban_reason
		FROM users
		WHERE username = $1
	`

	var user models.User
	err := r.db.QueryRow(ctx, query, username).Scan(
		&user.ID, &user.Email, &user.Username, &user.PasswordHash, &user.Phone, &user.Country,
		&user.KYCLevel, &user.Status, &user.RiskLevel, &user.ReferralCode, &user.ReferredBy,
		&user.DepositEnabled, &user.WithdrawalEnabled, &user.TradingEnabled, &user.OTPSecret,
		&user.OTPEnabled, &user.AntiPhishingCode, &user.CreatedAt, &user.UpdatedAt,
		&user.LastLoginAt, &user.LastLoginIP, &user.EmailVerifiedAt, &user.PhoneVerifiedAt,
		&user.BannedAt, &user.BanReason,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, fmt.Errorf("failed to get user by username: %w", err)
	}

	return &user, nil
}

func (r *UserRepository) GetByReferralCode(ctx context.Context, code string) (*models.User, error) {
	query := `
		SELECT id, email, username, password_hash, phone, country, kyc_level, status,
			risk_level, referral_code, referred_by, deposit_enabled, withdrawal_enabled,
			trading_enabled, otp_secret, otp_enabled, anti_phishing_code,
			created_at, updated_at, last_login_at, last_login_ip, email_verified_at,
			phone_verified_at, banned_at, ban_reason
		FROM users
		WHERE referral_code = $1
	`

	var user models.User
	err := r.db.QueryRow(ctx, query, code).Scan(
		&user.ID, &user.Email, &user.Username, &user.PasswordHash, &user.Phone, &user.Country,
		&user.KYCLevel, &user.Status, &user.RiskLevel, &user.ReferralCode, &user.ReferredBy,
		&user.DepositEnabled, &user.WithdrawalEnabled, &user.TradingEnabled, &user.OTPSecret,
		&user.OTPEnabled, &user.AntiPhishingCode, &user.CreatedAt, &user.UpdatedAt,
		&user.LastLoginAt, &user.LastLoginIP, &user.EmailVerifiedAt, &user.PhoneVerifiedAt,
		&user.BannedAt, &user.BanReason,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, fmt.Errorf("failed to get user by referral code: %w", err)
	}

	return &user, nil
}

func (r *UserRepository) Update(ctx context.Context, user *models.User) error {
	query := `
		UPDATE users SET
			email = $2, username = $3, password_hash = $4, phone = $5, country = $6,
			kyc_level = $7, status = $8, risk_level = $9, referral_code = $10,
			referred_by = $11, deposit_enabled = $12, withdrawal_enabled = $13,
			trading_enabled = $14, otp_secret = $15, otp_enabled = $16,
			anti_phishing_code = $17, updated_at = $18, last_login_at = $19,
			last_login_ip = $20, email_verified_at = $21, phone_verified_at = $22,
			banned_at = $23, ban_reason = $24
		WHERE id = $1
	`

	user.UpdatedAt = time.Now()

	_, err := r.db.Exec(ctx, query,
		user.ID, user.Email, user.Username, user.PasswordHash, user.Phone, user.Country,
		user.KYCLevel, user.Status, user.RiskLevel, user.ReferralCode, user.ReferredBy,
		user.DepositEnabled, user.WithdrawalEnabled, user.TradingEnabled, user.OTPSecret,
		user.OTPEnabled, user.AntiPhishingCode, user.UpdatedAt, user.LastLoginAt,
		user.LastLoginIP, user.EmailVerifiedAt, user.PhoneVerifiedAt, user.BannedAt, user.BanReason,
	)

	if err != nil {
		return fmt.Errorf("failed to update user: %w", err)
	}

	return nil
}

func (r *UserRepository) UpdateLastLogin(ctx context.Context, userID uuid.UUID, ipAddress string) error {
	query := `
		UPDATE users SET
			last_login_at = $2, last_login_ip = $3, updated_at = $4
		WHERE id = $1
	`

	now := time.Now()
	_, err := r.db.Exec(ctx, query, userID, now, ipAddress, now)
	if err != nil {
		return fmt.Errorf("failed to update last login: %w", err)
	}

	return nil
}

func (r *UserRepository) UpdatePassword(ctx context.Context, userID uuid.UUID, passwordHash string) error {
	query := `
		UPDATE users SET password_hash = $2, updated_at = $3 WHERE id = $1
	`

	_, err := r.db.Exec(ctx, query, userID, passwordHash, time.Now())
	if err != nil {
		return fmt.Errorf("failed to update password: %w", err)
	}

	return nil
}

func (r *UserRepository) EnableOTP(ctx context.Context, userID uuid.UUID, secret string) error {
	query := `
		UPDATE users SET otp_secret = $2, otp_enabled = true, updated_at = $3 WHERE id = $1
	`

	_, err := r.db.Exec(ctx, query, userID, secret, time.Now())
	if err != nil {
		return fmt.Errorf("failed to enable OTP: %w", err)
	}

	return nil
}

func (r *UserRepository) DisableOTP(ctx context.Context, userID uuid.UUID) error {
	query := `
		UPDATE users SET otp_secret = NULL, otp_enabled = false, updated_at = $2 WHERE id = $1
	`

	_, err := r.db.Exec(ctx, query, userID, time.Now())
	if err != nil {
		return fmt.Errorf("failed to disable OTP: %w", err)
	}

	return nil
}

func (r *UserRepository) SetStatus(ctx context.Context, userID uuid.UUID, status models.UserStatus, reason string) error {
	query := `
		UPDATE users SET 
			status = $2, ban_reason = $3, banned_at = $4, updated_at = $5
		WHERE id = $1
	`

	var bannedAt *time.Time
	if status == models.UserStatusBanned {
		now := time.Now()
		bannedAt = &now
	}

	_, err := r.db.Exec(ctx, query, userID, status, reason, bannedAt, time.Now())
	if err != nil {
		return fmt.Errorf("failed to set user status: %w", err)
	}

	return nil
}

func (r *UserRepository) EmailExists(ctx context.Context, email string) (bool, error) {
	query := `SELECT EXISTS(SELECT 1 FROM users WHERE email = $1)`
	var exists bool
	err := r.db.QueryRow(ctx, query, email).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("failed to check email existence: %w", err)
	}
	return exists, nil
}

func (r *UserRepository) UsernameExists(ctx context.Context, username string) (bool, error) {
	query := `SELECT EXISTS(SELECT 1 FROM users WHERE username = $1)`
	var exists bool
	err := r.db.QueryRow(ctx, query, username).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("failed to check username existence: %w", err)
	}
	return exists, nil
}

// SessionRepository manages user sessions
type SessionRepository struct {
	db *pgxpool.Pool
}

func NewSessionRepository(db *pgxpool.Pool) *SessionRepository {
	return &SessionRepository{db: db}
}

func (r *SessionRepository) Create(ctx context.Context, session *models.UserSession) error {
	query := `
		INSERT INTO user_sessions (
			id, user_id, session_token, refresh_token, ip_address, user_agent,
			device_id, expires_at, created_at, last_activity_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`

	if session.ID == uuid.Nil {
		session.ID = uuid.New()
	}
	session.CreatedAt = time.Now()
	session.LastActivityAt = session.CreatedAt

	_, err := r.db.Exec(ctx, query,
		session.ID, session.UserID, session.SessionToken, session.RefreshToken,
		session.IPAddress, session.UserAgent, session.DeviceID, session.ExpiresAt,
		session.CreatedAt, session.LastActivityAt,
	)

	if err != nil {
		return fmt.Errorf("failed to create session: %w", err)
	}

	return nil
}

func (r *SessionRepository) GetByToken(ctx context.Context, token string) (*models.UserSession, error) {
	query := `
		SELECT id, user_id, session_token, refresh_token, ip_address, user_agent,
			device_id, expires_at, created_at, last_activity_at
		FROM user_sessions
		WHERE session_token = $1 AND expires_at > NOW()
	`

	var session models.UserSession
	err := r.db.QueryRow(ctx, query, token).Scan(
		&session.ID, &session.UserID, &session.SessionToken, &session.RefreshToken,
		&session.IPAddress, &session.UserAgent, &session.DeviceID, &session.ExpiresAt,
		&session.CreatedAt, &session.LastActivityAt,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrSessionNotFound
		}
		return nil, fmt.Errorf("failed to get session by token: %w", err)
	}

	return &session, nil
}

func (r *SessionRepository) UpdateLastActivity(ctx context.Context, sessionID uuid.UUID) error {
	query := `
		UPDATE user_sessions SET last_activity_at = $2 WHERE id = $1
	`

	_, err := r.db.Exec(ctx, query, sessionID, time.Now())
	if err != nil {
		return fmt.Errorf("failed to update session activity: %w", err)
	}

	return nil
}

func (r *SessionRepository) Delete(ctx context.Context, sessionID uuid.UUID) error {
	query := `DELETE FROM user_sessions WHERE id = $1`
	_, err := r.db.Exec(ctx, query, sessionID)
	if err != nil {
		return fmt.Errorf("failed to delete session: %w", err)
	}
	return nil
}

func (r *SessionRepository) DeleteByToken(ctx context.Context, token string) error {
	query := `DELETE FROM user_sessions WHERE session_token = $1`
	_, err := r.db.Exec(ctx, query, token)
	if err != nil {
		return fmt.Errorf("failed to delete session by token: %w", err)
	}
	return nil
}

func (r *SessionRepository) DeleteAllUserSessions(ctx context.Context, userID uuid.UUID) error {
	query := `DELETE FROM user_sessions WHERE user_id = $1`
	_, err := r.db.Exec(ctx, query, userID)
	if err != nil {
		return fmt.Errorf("failed to delete user sessions: %w", err)
	}
	return nil
}

func (r *SessionRepository) DeleteExpired(ctx context.Context) error {
	query := `DELETE FROM user_sessions WHERE expires_at < NOW()`
	result, err := r.db.Exec(ctx, query)
	if err != nil {
		return fmt.Errorf("failed to delete expired sessions: %w", err)
	}
	_ = result.RowsAffected()
	return nil
}

// LoginAttemptRepository tracks login attempts
type LoginAttemptRepository struct {
	db *pgxpool.Pool
}

func NewLoginAttemptRepository(db *pgxpool.Pool) *LoginAttemptRepository {
	return &LoginAttemptRepository{db: db}
}

func (r *LoginAttemptRepository) Create(ctx context.Context, attempt *models.LoginAttempt) error {
	query := `
		INSERT INTO login_attempts (
			id, user_id, email, ip_address, success, reason, created_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7)
	`

	if attempt.ID == uuid.Nil {
		attempt.ID = uuid.New()
	}
	attempt.CreatedAt = time.Now()

	_, err := r.db.Exec(ctx, query,
		attempt.ID, attempt.UserID, attempt.Email, attempt.IPAddress,
		attempt.Success, attempt.Reason, attempt.CreatedAt,
	)

	if err != nil {
		return fmt.Errorf("failed to create login attempt: %w", err)
	}

	return nil
}

func (r *LoginAttemptRepository) GetFailedAttempts(ctx context.Context, email string, since time.Time) (int, error) {
	query := `
		SELECT COUNT(*) FROM login_attempts
		WHERE email = $1 AND success = false AND created_at > $2
	`

	var count int
	err := r.db.QueryRow(ctx, query, email, since).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to get failed login attempts: %w", err)
	}

	return count, nil
}

func (r *LoginAttemptRepository) GetFailedAttemptsByIP(ctx context.Context, ip string, since time.Time) (int, error) {
	query := `
		SELECT COUNT(*) FROM login_attempts
		WHERE ip_address = $1 AND success = false AND created_at > $2
	`

	var count int
	err := r.db.QueryRow(ctx, query, ip, since).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to get failed login attempts by IP: %w", err)
	}

	return count, nil
}

// RefreshTokenRepository manages JWT refresh tokens
type RefreshTokenRepository struct {
	db *pgxpool.Pool
}

func NewRefreshTokenRepository(db *pgxpool.Pool) *RefreshTokenRepository {
	return &RefreshTokenRepository{db: db}
}

func (r *RefreshTokenRepository) Create(ctx context.Context, token *models.RefreshToken) error {
	query := `
		INSERT INTO refresh_tokens (id, user_id, token, expires_at, created_at)
		VALUES ($1, $2, $3, $4, $5)
	`

	if token.ID == uuid.Nil {
		token.ID = uuid.New()
	}
	token.CreatedAt = time.Now()

	_, err := r.db.Exec(ctx, query,
		token.ID, token.UserID, token.Token, token.ExpiresAt, token.CreatedAt,
	)

	if err != nil {
		return fmt.Errorf("failed to create refresh token: %w", err)
	}

	return nil
}

func (r *RefreshTokenRepository) Get(ctx context.Context, tokenStr string) (*models.RefreshToken, error) {
	query := `
		SELECT id, user_id, token, expires_at, created_at
		FROM refresh_tokens
		WHERE token = $1
	`

	var token models.RefreshToken
	err := r.db.QueryRow(ctx, query, tokenStr).Scan(
		&token.ID, &token.UserID, &token.Token, &token.ExpiresAt, &token.CreatedAt,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrInvalidToken
		}
		return nil, fmt.Errorf("failed to get refresh token: %w", err)
	}

	if time.Now().After(token.ExpiresAt) {
		return nil, ErrTokenExpired
	}

	return &token, nil
}

func (r *RefreshTokenRepository) Delete(ctx context.Context, tokenStr string) error {
	query := `DELETE FROM refresh_tokens WHERE token = $1`
	_, err := r.db.Exec(ctx, query, tokenStr)
	if err != nil {
		return fmt.Errorf("failed to delete refresh token: %w", err)
	}
	return nil
}

func (r *RefreshTokenRepository) DeleteAllUserTokens(ctx context.Context, userID uuid.UUID) error {
	query := `DELETE FROM refresh_tokens WHERE user_id = $1`
	_, err := r.db.Exec(ctx, query, userID)
	if err != nil {
		return fmt.Errorf("failed to delete user refresh tokens: %w", err)
	}
	return nil
}

func (r *RefreshTokenRepository) DeleteExpired(ctx context.Context) error {
	query := `DELETE FROM refresh_tokens WHERE expires_at < NOW()`
	result, err := r.db.Exec(ctx, query)
	if err != nil {
		return fmt.Errorf("failed to delete expired refresh tokens: %w", err)
	}
	_ = result.RowsAffected()
	return nil
}

// PasswordResetRepository manages password reset tokens
type PasswordResetRepository struct {
	db *pgxpool.Pool
}

func NewPasswordResetRepository(db *pgxpool.Pool) *PasswordResetRepository {
	return &PasswordResetRepository{db: db}
}

func (r *PasswordResetRepository) Create(ctx context.Context, reset *models.PasswordReset) error {
	query := `
		INSERT INTO password_resets (id, user_id, token, used, expires_at, created_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`

	if reset.ID == uuid.Nil {
		reset.ID = uuid.New()
	}
	reset.CreatedAt = time.Now()
	reset.Used = false

	_, err := r.db.Exec(ctx, query,
		reset.ID, reset.UserID, reset.Token, reset.Used, reset.ExpiresAt, reset.CreatedAt,
	)

	if err != nil {
		return fmt.Errorf("failed to create password reset: %w", err)
	}

	return nil
}

func (r *PasswordResetRepository) Get(ctx context.Context, tokenStr string) (*models.PasswordReset, error) {
	query := `
		SELECT id, user_id, token, used, expires_at, created_at, used_at
		FROM password_resets
		WHERE token = $1
	`

	var reset models.PasswordReset
	err := r.db.QueryRow(ctx, query, tokenStr).Scan(
		&reset.ID, &reset.UserID, &reset.Token, &reset.Used,
		&reset.ExpiresAt, &reset.CreatedAt, &reset.UsedAt,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrInvalidToken
		}
		return nil, fmt.Errorf("failed to get password reset: %w", err)
	}

	if reset.Used {
		return nil, ErrInvalidToken
	}

	if time.Now().After(reset.ExpiresAt) {
		return nil, ErrTokenExpired
	}

	return &reset, nil
}

func (r *PasswordResetRepository) MarkUsed(ctx context.Context, resetID uuid.UUID) error {
	query := `UPDATE password_resets SET used = true, used_at = $2 WHERE id = $1`
	_, err := r.db.Exec(ctx, query, resetID, time.Now())
	if err != nil {
		return fmt.Errorf("failed to mark password reset as used: %w", err)
	}
	return nil
}

func (r *PasswordResetRepository) DeleteExpired(ctx context.Context) error {
	query := `DELETE FROM password_resets WHERE expires_at < NOW()`
	_, err := r.db.Exec(ctx, query)
	if err != nil {
		return fmt.Errorf("failed to delete expired password resets: %w", err)
	}
	return nil
}

// EmailVerificationRepository manages email verification
type EmailVerificationRepository struct {
	db *pgxpool.Pool
}

func NewEmailVerificationRepository(db *pgxpool.Pool) *EmailVerificationRepository {
	return &EmailVerificationRepository{db: db}
}

func (r *EmailVerificationRepository) Create(ctx context.Context, verification *models.EmailVerification) error {
	query := `
		INSERT INTO email_verifications (id, user_id, token, used, expires_at, created_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`

	if verification.ID == uuid.Nil {
		verification.ID = uuid.New()
	}
	verification.CreatedAt = time.Now()
	verification.Used = false

	_, err := r.db.Exec(ctx, query,
		verification.ID, verification.UserID, verification.Token, verification.Used,
		verification.ExpiresAt, verification.CreatedAt,
	)

	if err != nil {
		return fmt.Errorf("failed to create email verification: %w", err)
	}

	return nil
}

func (r *EmailVerificationRepository) Get(ctx context.Context, tokenStr string) (*models.EmailVerification, error) {
	query := `
		SELECT id, user_id, token, used, expires_at, created_at, used_at
		FROM email_verifications
		WHERE token = $1
	`

	var verification models.EmailVerification
	err := r.db.QueryRow(ctx, query, tokenStr).Scan(
		&verification.ID, &verification.UserID, &verification.Token, &verification.Used,
		&verification.ExpiresAt, &verification.CreatedAt, &verification.UsedAt,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrInvalidToken
		}
		return nil, fmt.Errorf("failed to get email verification: %w", err)
	}

	if verification.Used {
		return nil, ErrInvalidToken
	}

	if time.Now().After(verification.ExpiresAt) {
		return nil, ErrTokenExpired
	}

	return &verification, nil
}

func (r *EmailVerificationRepository) MarkUsed(ctx context.Context, verificationID uuid.UUID) error {
	query := `UPDATE email_verifications SET used = true, used_at = $2 WHERE id = $1`
	_, err := r.db.Exec(ctx, query, verificationID, time.Now())
	if err != nil {
		return fmt.Errorf("failed to mark email verification as used: %w", err)
	}
	return nil
}

func (r *EmailVerificationRepository) DeleteExpired(ctx context.Context) error {
	query := `DELETE FROM email_verifications WHERE expires_at < NOW()`
	_, err := r.db.Exec(ctx, query)
	if err != nil {
		return fmt.Errorf("failed to delete expired email verifications: %w", err)
	}
	return nil
}

// Suppress unused import warning
var _ = sql.ErrNoRows
