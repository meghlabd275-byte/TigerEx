package service

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
	"tigerex-backend/internal/repository"
)

var ErrInvalidCredentials = errors.New("invalid credentials")

// AuthService handles authentication
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
	Phone   string
}

type LoginResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn   int64     `json:"expires_in"`
	User       *UserDTO  `json:"user"`
}

type UserDTO struct {
	ID        string `json:"id"`
	Email     string `json:"email,omitempty"`
	Phone     string `json:"phone,omitempty"`
	Role      string `json:"role"`
	KycStatus string `json:"kyc_status"`
}

func (s *AuthService) Register(ctx context.Context, email, password string) (*UserDTO, error) {
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}

	user := repository.User{
		ID:        uuid.New().String(),
		Email:     email,
		Password:  string(hashedPassword),
		Status:    "active",
		KycStatus: "none",
		CreatedAt: time.Now(),
	}

	if err := s.db.Create(&user).Error; err != nil {
		return nil, err
	}

	return &UserDTO{
		ID:        user.ID,
		Email:     user.Email,
		Role:      user.Role,
		KycStatus: user.KycStatus,
	}, nil
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

	// Generate tokens (simplified)
	token := uuid.New().String()
	refreshToken := uuid.New().String()

	// Store session in Redis
	s.rdb.Set(ctx, "session:"+token, user.ID, 24*time.Hour)

	return &LoginResponse{
		AccessToken:   token,
		RefreshToken: refreshToken,
		ExpiresIn:   86400,
		User: &UserDTO{
			ID:        user.ID,
			Email:     user.Email,
			Phone:     user.Phone,
			Role:      user.Role,
			KycStatus: user.KycStatus,
		},
	}, nil
}

func (s *AuthService) RefreshToken(ctx context.Context, refreshToken string) (*LoginResponse, error) {
	// Simplified - real impl would verify JWT
	userID := s.rdb.Get(ctx, "refresh:"+refreshToken).Val()
	if userID == "" {
		return nil, ErrInvalidCredentials
	}

	newToken := uuid.New().String()
	return &LoginResponse{
		AccessToken:  newToken,
		ExpiresIn:  86400,
	}, nil
}

// OrderService handles orders
type OrderService struct {
	db  *gorm.DB
	rdb *redis.Client
}

func NewOrderService(db *gorm.DB, rdb *redis.Client) *OrderService {
	return &OrderService{db: db, rdb: rdb}
}

func (s *OrderService) CreateOrder(ctx context.Context, userID, symbol, side, orderType string, price, quantity int64) (*repository.Order, error) {
	order := repository.Order{
		ID:            uuid.New().String(),
		UserID:        userID,
		Symbol:        symbol,
		Side:          side,
		Type:          orderType,
		Price:         price,
		Quantity:     quantity,
		FilledQty:    0,
		Status:        "new",
		AvgPrice:      0,
		CreatedAt:    time.Now(),
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

// WalletService handles wallets
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
	return wallet.Balance, err
}

func (s *WalletService) Deposit(ctx context.Context, userID, currency string, amount int64, txHash string) (*repository.Transaction, error) {
	tx := repository.Transaction{
		ID:        uuid.New().String(),
		UserID:    userID,
		Type:      "deposit",
		Currency:  currency,
		Amount:   amount,
		TxHash:   txHash,
		Status:   "completed",
		CreatedAt: time.Now(),
	}

	s.db.Create(&tx)
	
	// Update wallet balance atomically
	s.db.Exec("UPDATE wallets SET balance = balance + ? WHERE user_id = ? AND currency = ?", 
		amount, userID, currency)

	return &tx, nil
}

func (s *WalletService) Withdraw(ctx context.Context, userID, currency string, amount int64, address string) (*repository.Transaction, error) {
	tx := repository.Transaction{
		ID:        uuid.New().String(),
		UserID:    userID,
		Type:     "withdrawal",
		Currency: currency,
		Amount:   amount,
		Address: address,
		Status:   "pending",
		CreatedAt: time.Now(),
	}

	s.db.Create(&tx)
	return &tx, nil
}