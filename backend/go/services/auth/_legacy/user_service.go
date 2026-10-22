package auth

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"
)

var (
	ErrEmailExists       = errors.New("email already exists")
	ErrUsernameExists    = errors.New("username already exists")
	ErrInvalidReferral  = errors.New("invalid referral code")
)

// UserRepository handles database operations for users
type UserRepository struct {
	db *sql.DB
}

// NewUserRepository creates a new user repository
func NewUserRepository(db *sql.DB) *UserRepository {
	return &UserRepository{db: db}
}

// CreateUser creates a new user in the database
func (r *UserRepository) CreateUser(ctx context.Context, user *User) error {
	query := `
		INSERT INTO users (
			id, email, username, password_hash, password_salt,
			two_factor_secret, two_factor_enabled, kyc_level, status,
			failed_attempts, locked_until, email_verified, phone_verified,
			referral_code, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
	`

	_, err := r.db.ExecContext(ctx, query,
		user.ID,
		user.Email,
		user.Username,
		user.PasswordHash,
		user.PasswordSalt,
		user.TwoFactorSecret,
		user.TwoFactorEnabled,
		user.KYCLevel,
		user.Status,
		user.FailedAttempts,
		user.LockedUntil,
		user.EmailVerified,
		user.PhoneVerified,
		user.ReferralCode,
		user.CreatedAt,
		user.UpdatedAt,
	)

	return err
}

// GetUserByEmail retrieves a user by email
func (r *UserRepository) GetUserByEmail(ctx context.Context, email string) (*User, error) {
	query := `
		SELECT id, email, username, password_hash, password_salt,
			two_factor_secret, two_factor_enabled, kyc_level, status,
			failed_attempts, locked_until, email_verified, phone_verified,
			referral_code, created_at, updated_at
		FROM users WHERE email = $1
	`

	user := &User{}
	err := r.db.QueryRowContext(ctx, query, email).Scan(
		&user.ID,
		&user.Email,
		&user.Username,
		&user.PasswordHash,
		&user.PasswordSalt,
		&user.TwoFactorSecret,
		&user.TwoFactorEnabled,
		&user.KYCLevel,
		&user.Status,
		&user.FailedAttempts,
		&user.LockedUntil,
		&user.EmailVerified,
		&user.PhoneVerified,
		&user.ReferralCode,
		&user.CreatedAt,
		&user.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, ErrUserNotFound
	}

	return user, err
}

// GetUserByID retrieves a user by ID
func (r *UserRepository) GetUserByID(ctx context.Context, id string) (*User, error) {
	query := `
		SELECT id, email, username, password_hash, password_salt,
			two_factor_secret, two_factor_enabled, kyc_level, status,
			failed_attempts, locked_until, email_verified, phone_verified,
			referral_code, created_at, updated_at
		FROM users WHERE id = $1
	`

	user := &User{}
	err := r.db.QueryRowContext(ctx, query, id).Scan(
		&user.ID,
		&user.Email,
		&user.Username,
		&user.PasswordHash,
		&user.PasswordSalt,
		&user.TwoFactorSecret,
		&user.TwoFactorEnabled,
		&user.KYCLevel,
		&user.Status,
		&user.FailedAttempts,
		&user.LockedUntil,
		&user.EmailVerified,
		&user.PhoneVerified,
		&user.ReferralCode,
		&user.CreatedAt,
		&user.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, ErrUserNotFound
	}

	return user, err
}

// GetUserByUsername retrieves a user by username
func (r *UserRepository) GetUserByUsername(ctx context.Context, username string) (*User, error) {
	query := `
		SELECT id, email, username, password_hash, password_salt,
			two_factor_secret, two_factor_enabled, kyc_level, status,
			failed_attempts, locked_until, email_verified, phone_verified,
			referral_code, created_at, updated_at
		FROM users WHERE username = $1
	`

	user := &User{}
	err := r.db.QueryRowContext(ctx, query, username).Scan(
		&user.ID,
		&user.Email,
		&user.Username,
		&user.PasswordHash,
		&user.PasswordSalt,
		&user.TwoFactorSecret,
		&user.TwoFactorEnabled,
		&user.KYCLevel,
		&user.Status,
		&user.FailedAttempts,
		&user.LockedUntil,
		&user.EmailVerified,
		&user.PhoneVerified,
		&user.ReferralCode,
		&user.CreatedAt,
		&user.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, ErrUserNotFound
	}

	return user, err
}

// UpdateUser updates a user in the database
func (r *UserRepository) UpdateUser(ctx context.Context, user *User) error {
	query := `
		UPDATE users SET
			email = $2,
			username = $3,
			password_hash = $4,
			password_salt = $5,
			two_factor_secret = $6,
			two_factor_enabled = $7,
			kyc_level = $8,
			status = $9,
			failed_attempts = $10,
			locked_until = $11,
			email_verified = $12,
			phone_verified = $13,
			updated_at = $14
		WHERE id = $1
	`

	user.UpdatedAt = time.Now()

	_, err := r.db.ExecContext(ctx, query,
		user.ID,
		user.Email,
		user.Username,
		user.PasswordHash,
		user.PasswordSalt,
		user.TwoFactorSecret,
		user.TwoFactorEnabled,
		user.KYCLevel,
		user.Status,
		user.FailedAttempts,
		user.LockedUntil,
		user.EmailVerified,
		user.PhoneVerified,
		user.UpdatedAt,
	)

	return err
}

// CheckEmailExists checks if an email already exists
func (r *UserRepository) CheckEmailExists(ctx context.Context, email string) (bool, error) {
	var count int
	err := r.db.QueryRowContext(ctx, 
		"SELECT COUNT(*) FROM users WHERE email = $1", email).Scan(&count)
	return count > 0, err
}

// CheckUsernameExists checks if a username already exists
func (r *UserRepository) CheckUsernameExists(ctx context.Context, username string) (bool, error) {
	var count int
	err := r.db.QueryRowContext(ctx, 
		"SELECT COUNT(*) FROM users WHERE username = $1", username).Scan(&count)
	return count > 0, err
}

// ValidateReferralCode validates a referral code and returns referrer ID
func (r *UserRepository) ValidateReferralCode(ctx context.Context, code string) (string, error) {
	var userID string
	err := r.db.QueryRowContext(ctx,
		"SELECT id FROM users WHERE referral_code = $1", code).Scan(&userID)
	
	if err == sql.ErrNoRows {
		return "", ErrInvalidReferral
	}
	
	return userID, err
}

// IncrementLoginAttempts increments failed login attempts for a user
func (r *UserRepository) IncrementLoginAttempts(ctx context.Context, userID string) error {
	query := `
		UPDATE users SET 
			failed_attempts = failed_attempts + 1,
			locked_until = CASE 
				WHEN failed_attempts + 1 >= 5 THEN NOW() + INTERVAL '15 minutes'
				ELSE NULL
			END,
			status = CASE
				WHEN failed_attempts + 1 >= 5 THEN 'locked'
				ELSE status
			END
		WHERE id = $1
	`

	_, err := r.db.ExecContext(ctx, query, userID)
	return err
}

// ResetLoginAttempts resets failed login attempts for a user
func (r *UserRepository) ResetLoginAttempts(ctx context.Context, userID string) error {
	query := `
		UPDATE users SET 
			failed_attempts = 0,
			locked_until = NULL,
			status = 'active'
		WHERE id = $1
	`

	_, err := r.db.ExecContext(ctx, query, userID)
	return err
}

// =============================================================================
// USER SERVICE
// =============================================================================

type UserService struct {
	repo       *UserRepository
	authService *AuthService
}

// NewUserService creates a new user service
func NewUserService(db *sql.DB, authService *AuthService) *UserService {
	return &UserService{
		repo:       NewUserRepository(db),
		authService: authService,
	}
}

// Register creates a new user account
func (s *UserService) Register(ctx context.Context, req *RegisterRequest) (*User, error) {
	// Check if email exists
	exists, err := s.repo.CheckEmailExists(ctx, req.Email)
	if err != nil {
		return nil, err
	}
	if exists {
		return nil, ErrEmailExists
	}

	// Check if username exists
	exists, err = s.repo.CheckUsernameExists(ctx, req.Username)
	if err != nil {
		return nil, err
	}
	if exists {
		return nil, ErrUsernameExists
	}

	// Validate referral code if provided
	var referrerID string
	if req.ReferralCode != "" {
		referrerID, err = s.repo.ValidateReferralCode(ctx, req.ReferralCode)
		if err != nil {
			return nil, ErrInvalidReferral
		}
	}

	// Create user using auth service
	user, err := s.authService.CreateUser(ctx, req)
	if err != nil {
		return nil, err
	}

	// Set referrer if applicable
	if referrerID != "" {
		// Would create referral record here
		_ = referrerID
	}

	// Save to database
	err = s.repo.CreateUser(ctx, user)
	if err != nil {
		return nil, err
	}

	// Don't return password hash
	user.PasswordHash = ""
	user.PasswordSalt = ""

	return user, nil
}

// Login authenticates a user
func (s *UserService) Login(ctx context.Context, req *LoginRequest) (*AuthResponse, error) {
	// Get user by email
	user, err := s.repo.GetUserByEmail(ctx, req.Email)
	if err != nil {
		if err == ErrUserNotFound {
			// Return generic error for security
			return nil, ErrInvalidCredentials
		}
		return nil, err
	}

	// Check if account is locked
	if err := s.authService.CheckAccountLock(user); err != nil {
		return nil, err
	}

	// Verify password
	if !s.authService.VerifyPassword(req.Password, user.PasswordHash) {
		// Increment failed attempts
		_ = s.repo.IncrementLoginAttempts(ctx, user.ID)
		return nil, ErrInvalidCredentials
	}

	// Check if 2FA is enabled
	if user.TwoFactorEnabled && req.TwoFactorCode == "" {
		return nil, Err2FARequired
	}

	// Verify 2FA if enabled
	if user.TwoFactorEnabled && req.TwoFactorCode != "" {
		// Would verify TOTP code here
		_ = req.TwoFactorCode
	}

	// Reset failed attempts on successful login
	_ = s.repo.ResetLoginAttempts(ctx, user.ID)

	// Create session
	session, err := s.authService.CreateSession(ctx, user, req)
	if err != nil {
		return nil, err
	}

	// Don't return password hash
	user.PasswordHash = ""
	user.PasswordSalt = ""

	return &AuthResponse{
		AccessToken:  session.AccessToken,
		RefreshToken: session.RefreshToken,
		ExpiresAt:    session.ExpiresAt.Unix(),
		TokenType:    "Bearer",
		User:         user,
	}, nil
}

// GetUserByID retrieves a user by ID
func (s *UserService) GetUserByID(ctx context.Context, userID string) (*User, error) {
	user, err := s.repo.GetUserByID(ctx, userID)
	if err != nil {
		return nil, err
	}

	user.PasswordHash = ""
	user.PasswordSalt = ""

	return user, nil
}

// UpdateUser updates user information
func (s *UserService) UpdateUser(ctx context.Context, user *User) error {
	return s.repo.UpdateUser(ctx, user)
}

// GenerateUserID generates a new unique user ID
func GenerateUserID() string {
	return uuid.New().String()
}
