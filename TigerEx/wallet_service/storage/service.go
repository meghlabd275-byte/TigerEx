package wallet

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Transaction types
type TransactionType string

const (
	TxDeposit    TransactionType = "DEPOSIT"
	TxWithdrawal TransactionType = "WITHDRAWAL"
	TxTransfer  TransactionType = "TRANSFER"
	TxTrade    TransactionType = "TRADE"
	TxFee      TransactionType = "FEE"
	TxAward    TransactionType = "AWARD"
	TxRefund   TransactionType = "REFUND"
)

type Transaction struct {
	ID          string          `json:"id"`
	UserID     string          `json:"userId"`
	Asset      string          `json:"asset"`
	Type       TransactionType `json:"type"`
	Amount     float64        `json:"amount"`
	Fee        float64        `json:"fee"`
	Balance    float64        `json:"balance"`
	Reference string        `json:"reference"`
	Status    string        `json:"status"`
	CreatedAt  time.Time      `json:"createdAt"`
	ConfirmedAt *time.Time    `json:"confirmedAt,omitempty"`
}

// Balance management service
type Service struct {
	db Database
}

// Database interface
type Database interface {
	Credit(ctx context.Context, userID, asset string, amount float64, txType TransactionType, reference string) error
	Debit(ctx context.Context, userID, asset string, amount float64, txType TransactionType, reference string) error
	GetBalance(ctx context.Context, userID, asset string) (float64, error)
	GetTransactions(ctx context.Context, userID, asset string, limit int) ([]*Transaction, error)
}

// NewService creates wallet service
func NewService(db Database) *Service {
	return &Service{db: db}
}

// Deposit handles deposit
func (s *Service) Deposit(ctx context.Context, userID, asset string, amount float64, reference string) error {
	if amount <= 0 {
		return fmt.Errorf("invalid amount")
	}

	return s.db.Credit(ctx, userID, asset, amount, TxDeposit, reference)
}

// Withdraw handles withdrawal
func (s *Service) Withdraw(ctx context.Context, userID, asset string, amount float64, reference string) error {
	if amount <= 0 {
		return fmt.Errorf("invalid amount")
	}

	return s.db.Debit(ctx, userID, asset, amount, TxWithdrawal, reference)
}

// Transfer handles transfer
func (s *Service) Transfer(ctx context.Context, fromUserID, toUserID, asset string, amount float64) error {
	if amount <= 0 {
		return fmt.Errorf("invalid amount")
	}

	txID := uuid.New().String()

	// Deduct from sender
	if err := s.db.Debit(ctx, fromUserID, asset, amount, TxTransfer, txID+"-debit"); err != nil {
		return err
	}

	// Credit to receiver
	if err := s.db.Credit(ctx, toUserID, asset, amount, TxTransfer, txID+"-credit"); err != nil {
		// Rollback - this is simplified, in production use proper transactions
		s.db.Credit(ctx, fromUserID, asset, amount, TxRefund, txID+"-rollback")
		return err
	}

	return nil
}

// GetBalance gets balance
func (s *Service) GetBalance(ctx context.Context, userID, asset string) (float64, error) {
	return s.db.GetBalance(ctx, userID, asset)
}

// GetTransactions gets transaction history
func (s *Service) GetTransactions(ctx context.Context, userID, asset string, limit int) ([]*Transaction, error) {
	if limit <= 0 {
		limit = 50
	}
	return s.db.GetTransactions(ctx, userID, asset, limit)
}

// GenerateDepositAddress generates deposit address (stub - needs blockchain integration)
func (s *Service) GenerateDepositAddress(asset, userID string) (string, error) {
	// In production, this would integrate with blockchain nodes
	return fmt.Sprintf("%s:%s", asset, uuid.New().String()), nil
}

// ValidateWithdrawalAddress validates withdrawal address
func (s *Service) ValidateWithdrawalAddress(asset, address string) error {
	// In production, validate based on asset type
	if address == "" {
		return fmt.Errorf("invalid address")
	}
	return nil
}