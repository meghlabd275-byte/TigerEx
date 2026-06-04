package auth

import (
    "errors"
    "time"
    "sync"
    "crypto/rand"
    "encoding/base64"
    "golang.org/x/crypto/bcrypt"
)

const (
    MinPasswordLength = 8
    MaxPasswordLength = 128
    BcryptCost = 12
    MaxFailedAttempts = 5
    LockoutDuration = 15 * time.Minute
)

var (
    ErrInvalidEmail       = errors.New("invalid email format")
    ErrInvalidPassword    = errors.New("password does not meet requirements")
    ErrWeakPassword       = errors.New("password is too weak")
    ErrAccountLocked      = errors.New("account is temporarily locked")
    ErrInvalidToken       = errors.New("invalid or expired token")
    ErrInvalidCredentials = errors.New("invalid email or password")
    ErrUserNotFound       = errors.New("user not found")
    ErrEmailExists        = errors.New("email already exists")
)

type User struct {
    ID                 string    `json:"id"`
    Email              string    `json:"email"`
    Phone              string    `json:"phone"`
    PasswordHash       string    `json:"-"`
    TwoFactorSecret    string    `json:"-"`
    TwoFactorEnabled   bool      `json:"two_factor_enabled"`
    KYCLevel           int       `json:"kyc_level"`
    Status             string    `json:"status"`
    Country            string    `json:"country"`
    FailedLoginAttempts int      `json:"failed_login_attempts"`
    LockedUntil        time.Time `json:"locked_until"`
    CreatedAt          time.Time `json:"created_at"`
    UpdatedAt          time.Time `json:"updated_at"`
}

type Session struct {
    ID             string    `json:"id"`
    UserID         string    `json:"user_id"`
    TokenHash      string    `json:"-"`
    RefreshToken   string    `json:"refresh_token"`
    IPAddress      string    `json:"ip_address"`
    UserAgent      string    `json:"user_agent"`
    ExpiresAt      time.Time `json:"expires_at"`
    CreatedAt      time.Time `json:"created_at"`
}

type ApiKey struct {
    ID          string   `json:"id"`
    UserID      string   `json:"user_id"`
    KeyID       string   `json:"key_id"`
    Name        string   `json:"name"`
    Permissions []string `json:"permissions"`
    IPWhitelist []string `json:"ip_whitelist"`
    RateLimit   int      `json:"rate_limit"`
    LastUsedAt  time.Time `json:"last_used_at"`
    ExpiresAt   time.Time `json:"expires_at"`
    CreatedAt   time.Time `json:"created_at"`
}

type AuthService struct {
    mu      sync.RWMutex
    users   map[string]*User
    sessions map[string]*Session
}

func NewAuthService() *AuthService {
    return &AuthService{
        users:    make(map[string]*User),
        sessions: make(map[string]*Session),
    }
}

func (s *AuthService) Register(email, password string) (*User, error) {
    if err := ValidateEmail(email); err != nil {
        return nil, err
    }
    if err := ValidatePasswordStrength(password); err != nil {
        return nil, err
    }
    s.mu.Lock()
    defer s.mu.Unlock()
    for _, u := range s.users {
        if u.Email == email {
            return nil, ErrEmailExists
        }
    }
    hash, err := bcrypt.GenerateFromPassword([]byte(password), BcryptCost)
    if err != nil {
        return nil, err
    }
    user := &User{
        ID:          generateID(),
        Email:       email,
        PasswordHash: string(hash),
        Status:      "active",
        KYCLevel:    0,
        CreatedAt:   time.Now(),
        UpdatedAt:   time.Now(),
    }
    s.users[email] = user
    return user, nil
}

func (s *AuthService) Login(email, password, ipAddress string) (*Session, error) {
    s.mu.Lock()
    user, exists := s.users[email]
    if !exists {
        return nil, ErrInvalidCredentials
    }
    s.mu.Unlock()
    
    if err := user.CanLogin(); err != nil {
        return nil, err
    }
    
    if !bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)) {
        s.mu.Lock()
        user.IncrementFailedAttempts()
        s.mu.Unlock()
        return nil, ErrInvalidCredentials
    }
    
    s.mu.Lock()
    user.ResetFailedAttempts()
    user.LastLoginAt = time.Now()
    user.LastLoginIP = ipAddress
    session := &Session{
        ID:        generateID(),
        UserID:    user.ID,
        TokenHash: generateToken(),
        ExpiresAt: time.Now().Add(24 * time.Hour),
        CreatedAt: time.Now(),
        IPAddress: ipAddress,
    }
    s.sessions[session.TokenHash] = session
    s.mu.Unlock()
    
    return session, nil
}

func (s *AuthService) ValidateSession(token string) (*Session, error) {
    s.mu.RLock()
    defer s.mu.RUnlock()
    session, exists := s.sessions[token]
    if !exists {
        return nil, ErrInvalidToken
    }
    if session.IsExpired() {
        return nil, ErrInvalidToken
    }
    return session, nil
}

func (s *AuthService) Logout(token string) {
    s.mu.Lock()
    defer s.mu.Unlock()
    delete(s.sessions, token)
}

func (s *AuthService) GenerateAPIKey(userID, name string, permissions []string) (*ApiKey, error) {
    keyID := generateAPIKeyID()
    keySecret := generateAPISecret()
    
    apiKey := &ApiKey{
        ID:          generateID(),
        UserID:      userID,
        KeyID:       keyID,
        Name:        name,
        Permissions: permissions,
        RateLimit:   600,
        CreatedAt:   time.Now(),
    }
    
    return apiKey, nil
}

func ValidateEmail(email string) error {
    if len(email) < 3 || len(email) > 255 {
        return ErrInvalidEmail
    }
    atIndex := -1
    for i, ch := range email {
        if ch == '@' {
            atIndex = i
        }
    }
    if atIndex < 1 {
        return ErrInvalidEmail
    }
    return nil
}

func ValidatePasswordStrength(password string) error {
    if len(password) < MinPasswordLength {
        return ErrWeakPassword
    }
    hasUpper := false
    hasLower := false
    hasDigit := false
    for _, ch := range password {
        if ch >= 'A' && ch <= 'Z' {
            hasUpper = true
        }
        if ch >= 'a' && ch <= 'z' {
            hasLower = true
        }
        if ch >= '0' && ch <= '9' {
            hasDigit = true
        }
    }
    strengthScore := 0
    if hasUpper { strengthScore++ }
    if hasLower { strengthScore++ }
    if hasDigit { strengthScore++ }
    if strengthScore < 2 {
        return ErrWeakPassword
    }
    return nil
}

func (u *User) CanLogin() error {
    if u.Status == "locked" || u.Status == "suspended" {
        return errors.New("account unavailable")
    }
    if u.IsLocked() {
        return ErrAccountLocked
    }
    return nil
}

func (u *User) IsLocked() bool {
    return !u.LockedUntil.IsZero() && u.LockedUntil.After(time.Now())
}

func (u *User) IncrementFailedAttempts() {
    u.FailedLoginAttempts++
    if u.FailedLoginAttempts >= MaxFailedAttempts {
        u.LockedUntil = time.Now().Add(LockoutDuration)
    }
}

func (u *User) ResetFailedAttempts() {
    u.FailedLoginAttempts = 0
    u.LockedUntil = time.Time{}
}

func (u *User) LastLoginAt time.Time { return time.Time{} }
func (u *User) LastLoginIP string     { return "" }

func (s *Session) IsExpired() bool {
    return time.Now().After(s.ExpiresAt)
}

func generateID() string {
    b := make([]byte, 16)
    rand.Read(b)
    return base64.URLEncoding.EncodeToString(b)
}

func generateToken() string {
    b := make([]byte, 32)
    rand.Read(b)
    return base64.URLEncoding.EncodeToString(b)
}

func generateAPIKeyID() string {
    b := make([]byte, 8)
    rand.Read(b)
    return "TX" + base64.URLEncoding.EncodeToString(b)
}

func generateAPISecret() string {
    b := make([]byte, 32)
    rand.Read(b)
    return base64.URLEncoding.EncodeToString(b)
}