package service

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"tigerex-backend/internal/repository"
)

var (
	ErrInvalidCredentials  = errors.New("invalid credentials")
	ErrEmailExists         = errors.New("email already registered")
	ErrInsufficientBalance = errors.New("insufficient balance")
	ErrWalletNotFound      = errors.New("wallet not found")
	ErrDuplicateDeposit    = errors.New("deposit already credited")
	ErrInvalidToken        = errors.New("invalid or expired token")
)

const (
	bcryptCost      = 12
	accessTokenTTL  = 24 * time.Hour
	refreshTokenTTL = 30 * 24 * time.Hour
)

// newOpaqueToken returns a 256-bit URL-safe random token.
func newOpaqueToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// AuthService handles authentication.
type AuthService struct {
	db  *gorm.DB
	rdb *redis.Client
}

func NewAuthService(db *gorm.DB, rdb *redis.Client) *AuthService {
	return &AuthService{db: db, rdb: rdb}
}

type RegisterInput struct {
	Email    string
	Password string
	Phone    string
}

type LoginResponse struct {
	AccessToken  string   `json:"access_token"`
	RefreshToken string   `json:"refresh_token"`
	ExpiresIn    int64    `json:"expires_in"`
	User         *UserDTO `json:"user"`
}

type UserDTO struct {
	ID        string `json:"id"`
	Email     string `json:"email,omitempty"`
	Phone     string `json:"phone,omitempty"`
	Role      string `json:"role"`
	KycStatus string `json:"kyc_status"`
}

func toDTO(u *repository.User) *UserDTO {
	return &UserDTO{
		ID:        u.ID,
		Email:     u.Email,
		Phone:     u.Phone,
		Role:      u.Role,
		KycStatus: u.KycStatus,
	}
}

func (s *AuthService) Register(ctx context.Context, email, password string) (*UserDTO, error) {
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	if err != nil {
		return nil, err
	}

	user := repository.User{
		ID:        uuid.New().String(),
		Email:     email,
		Password:  string(hashedPassword),
		Role:      "user",
		Status:    "active",
		KycStatus: "none",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	if err := s.db.Create(&user).Error; err != nil {
		// A unique-constraint violation means the address is already taken.
		return nil, ErrEmailExists
	}

	return toDTO(&user), nil
}

func (s *AuthService) Login(ctx context.Context, identifier, password string) (*LoginResponse, error) {
	var user repository.User
	result := s.db.Where("email = ? OR phone = ?", identifier, identifier).First(&user)
	if result.Error != nil {
		return nil, ErrInvalidCredentials
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(password)); err != nil {
		return nil, ErrInvalidCredentials
	}

	accessToken, err := newOpaqueToken()
	if err != nil {
		return nil, err
	}
	refreshToken, err := newOpaqueToken()
	if err != nil {
		return nil, err
	}

	// The access token is stored raw so the auth middleware can resolve it; the
	// refresh token is stored only as a digest, so a leaked store yields no
	// usable refresh credential.
	if err := s.rdb.Set(ctx, "session:"+accessToken, user.ID, accessTokenTTL).Err(); err != nil {
		return nil, err
	}
	if err := s.rdb.Set(ctx, "refresh:"+repository.HashToken(refreshToken), user.ID, refreshTokenTTL).Err(); err != nil {
		return nil, err
	}

	return &LoginResponse{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    int64(accessTokenTTL.Seconds()),
		User:         toDTO(&user),
	}, nil
}

func (s *AuthService) RefreshToken(ctx context.Context, refreshToken string) (*LoginResponse, error) {
	userID, err := s.rdb.Get(ctx, "refresh:"+repository.HashToken(refreshToken)).Result()
	if err == redis.Nil || userID == "" {
		return nil, ErrInvalidToken
	}
	if err != nil {
		return nil, err
	}

	accessToken, err := newOpaqueToken()
	if err != nil {
		return nil, err
	}
	if err := s.rdb.Set(ctx, "session:"+accessToken, userID, accessTokenTTL).Err(); err != nil {
		return nil, err
	}

	return &LoginResponse{
		AccessToken: accessToken,
		ExpiresIn:   int64(accessTokenTTL.Seconds()),
	}, nil
}

// OrderService handles orders.
type OrderService struct {
	db  *gorm.DB
	rdb *redis.Client
}

func NewOrderService(db *gorm.DB, rdb *redis.Client) *OrderService {
	return &OrderService{db: db, rdb: rdb}
}

func (s *OrderService) CreateOrder(ctx context.Context, userID, symbol, side, orderType string, price, quantity int64) (*repository.Order, error) {
	order := repository.Order{
		ID:        uuid.New().String(),
		UserID:    userID,
		Symbol:    symbol,
		Side:      side,
		Type:      orderType,
		Price:     price,
		Quantity:  quantity,
		FilledQty: 0,
		Status:    "new",
		AvgPrice:  0,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	if err := s.db.Create(&order).Error; err != nil {
		return nil, err
	}

	return &order, nil
}

func (s *OrderService) GetOrder(ctx context.Context, userID, orderID string) (*repository.Order, error) {
	var order repository.Order
	if err := s.db.Where("id = ? AND user_id = ?", orderID, userID).First(&order).Error; err != nil {
		return nil, err
	}
	return &order, nil
}

func (s *OrderService) ListOrders(ctx context.Context, userID, symbol, status, limit string) ([]repository.Order, error) {
	var orders []repository.Order
	query := s.db.Where("user_id = ?", userID)

	if symbol != "" {
		query = query.Where("symbol = ?", symbol)
	}
	if status != "" {
		query = query.Where("status = ?", status)
	}

	query.Limit(50).Find(&orders)
	return orders, nil
}

func (s *OrderService) CancelOrder(ctx context.Context, userID, orderID string) error {
	result := s.db.Model(&repository.Order{}).
		Where("id = ? AND user_id = ? AND status = ?", orderID, userID, "new").
		Update("status", "cancelled")

	if result.RowsAffected == 0 {
		return errors.New("order not found or cannot be cancelled")
	}
	return nil
}

// UserService reads and updates a user's profile and preferences.
type UserService struct {
	db  *gorm.DB
	rdb *redis.Client
}

func NewUserService(db *gorm.DB, rdb *redis.Client) *UserService {
	return &UserService{db: db, rdb: rdb}
}

func (s *UserService) GetProfile(ctx context.Context, userID string) (*repository.User, error) {
	var user repository.User
	if err := s.db.Where("id = ?", userID).First(&user).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

// UpdateProfile changes the contact fields. An empty argument leaves that field
// untouched, so a caller can update one field without resending the other.
func (s *UserService) UpdateProfile(ctx context.Context, userID, email, phone string) (*repository.User, error) {
	updates := map[string]interface{}{"updated_at": time.Now()}
	if email != "" {
		updates["email"] = email
	}
	if phone != "" {
		updates["phone"] = phone
	}

	res := s.db.Model(&repository.User{}).Where("id = ?", userID).Updates(updates)
	if res.Error != nil {
		return nil, res.Error
	}
	if res.RowsAffected == 0 {
		return nil, errors.New("user not found")
	}

	return s.GetProfile(ctx, userID)
}

// UpdatePreferences persists a user's UI preferences as a JSON document. The
// value is stored per user and replaced wholesale.
func (s *UserService) UpdatePreferences(ctx context.Context, userID string, prefs map[string]string) error {
	blob, err := json.Marshal(prefs)
	if err != nil {
		return err
	}
	return s.rdb.Set(ctx, "prefs:"+userID, blob, 0).Err()
}

// WalletService handles wallets.
type WalletService struct {
	db  *gorm.DB
	rdb *redis.Client
}

func NewWalletService(db *gorm.DB, rdb *redis.Client) *WalletService {
	return &WalletService{db: db, rdb: rdb}
}

func (s *WalletService) ListWallets(ctx context.Context, userID string) ([]repository.Wallet, error) {
	var wallets []repository.Wallet
	s.db.Where("user_id = ?", userID).Find(&wallets)
	return wallets, nil
}

func (s *WalletService) GetBalance(ctx context.Context, userID, currency string) (int64, error) {
	var wallet repository.Wallet
	err := s.db.Where("user_id = ? AND currency = ?", userID, currency).First(&wallet).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, ErrWalletNotFound
	}
	return wallet.Balance, err
}

// Deposit credits a verified on-chain deposit exactly once.
//
// A deposit is keyed by its transaction hash: a hash that was already credited
// returns ErrDuplicateDeposit rather than crediting the balance again, so a
// replayed callback cannot mint funds. The ledger row and the balance move
// happen in one database transaction.
func (s *WalletService) Deposit(ctx context.Context, userID, currency string, amount int64, txHash string) (*repository.Transaction, error) {
	if amount <= 0 {
		return nil, errors.New("deposit amount must be positive")
	}
	if txHash == "" {
		return nil, errors.New("deposit requires a transaction hash")
	}

	var tx repository.Transaction
	err := s.db.Transaction(func(d *gorm.DB) error {
		var existing repository.Transaction
		e := d.Where("tx_hash = ? AND type = ?", txHash, "deposit").First(&existing).Error
		if e == nil {
			return ErrDuplicateDeposit
		}
		if !errors.Is(e, gorm.ErrRecordNotFound) {
			return e
		}

		tx = repository.Transaction{
			ID:        uuid.New().String(),
			UserID:    userID,
			Type:      "deposit",
			Currency:  currency,
			Amount:    amount,
			TxHash:    txHash,
			Status:    "completed",
			CreatedAt: time.Now(),
		}
		if e := d.Create(&tx).Error; e != nil {
			return e
		}

		wallet := repository.Wallet{
			ID:        uuid.New().String(),
			UserID:    userID,
			Currency:  currency,
			Balance:   amount,
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}
		return d.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "user_id"}, {Name: "currency"}},
			DoUpdates: clause.Assignments(map[string]interface{}{"balance": gorm.Expr("wallets.balance + ?", amount)}),
		}).Create(&wallet).Error
	})
	if err != nil {
		return nil, err
	}

	return &tx, nil
}

// Withdraw reserves funds for a withdrawal. It fails closed when the wallet
// cannot cover the amount, and debits the balance before returning so the same
// funds cannot be withdrawn twice.
func (s *WalletService) Withdraw(ctx context.Context, userID, currency string, amount int64, address string) (*repository.Transaction, error) {
	if amount <= 0 {
		return nil, errors.New("withdrawal amount must be positive")
	}
	if address == "" {
		return nil, errors.New("withdrawal requires a destination address")
	}

	var tx repository.Transaction
	err := s.db.Transaction(func(d *gorm.DB) error {
		res := d.Model(&repository.Wallet{}).
			Where("user_id = ? AND currency = ? AND balance >= ?", userID, currency, amount).
			Update("balance", gorm.Expr("balance - ?", amount))
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return ErrInsufficientBalance
		}

		tx = repository.Transaction{
			ID:        uuid.New().String(),
			UserID:    userID,
			Type:      "withdrawal",
			Currency:  currency,
			Amount:    amount,
			Address:   address,
			Status:    "pending",
			CreatedAt: time.Now(),
		}
		return d.Create(&tx).Error
	})
	if err != nil {
		return nil, err
	}

	return &tx, nil
}
