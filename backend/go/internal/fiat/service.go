// Package fiat provides fiat payment integration services
package fiat

import (
	"context"
	"errors"

	"github.com/google/uuid"

	"tigerex-api/internal/api"
)

var (
	ErrOrderNotFound = errors.New("order not found")
	ErrInvalidAmount = errors.New("invalid amount")
)

type Config struct {
	SimplexAPIKey string
	MoonPayAPIKey string
	TransakAPIKey string
	AdyenMerchantCode string
}

type FiatProvider struct {
	ID               string
	Name             string
	Type             string
	SupportedAssets  []string
	SupportedFiat   []string
	MinAmount       float64
	MaxAmount       float64
	FeePercent      float64
	Enabled         bool
}

type Order struct {
	ID               string
	UserID           string
	Provider         string
	Type             string
	Asset            string
	FiatCurrency     string
	Amount           float64
	CryptoAmount    float64
	Fee              float64
	Status           string
	ProviderOrderID  string
	RedirectURL      string
	ReturnURL       string
	CreatedAt        int64
	UpdatedAt        int64
}

type BankAccount struct {
	ID            string
	UserID       string
	BankName     string
	BankCode     string
	AccountNumber string
	AccountName  string
	AccountType  string
	Country      string
	Swift        string
	Status       string
	CreatedAt    int64
}

type Card struct {
	ID         string
	UserID    string
	Last4     string
	Brand     string
	ExpMonth  int
	ExpYear   int
	IsDefault bool
	CreatedAt int64
}

type Service struct {
	config       Config
	providers    map[string]*FiatProvider
	orders       map[string]*Order
	bankAccounts map[string]*BankAccount
	cards        map[string]*Card
}

func NewService(config Config) *Service {
	return &Service{
		config: config,
		providers:    make(map[string]*FiatProvider),
		orders:       make(map[string]*Order),
		bankAccounts: make(map[string]*BankAccount),
		cards:        make(map[string]*Card),
	}
}

func (s *Service) InitializeProviders() {
	providers := []*FiatProvider{
		{ID: "simplex", Name: "Simplex", Type: "card", SupportedAssets: []string{"BTC", "ETH", "USDT", "USDC"}, SupportedFiat: []string{"USD", "EUR", "GBP"}, MinAmount: 50, MaxAmount: 20000, FeePercent: 3.5, Enabled: true},
		{ID: "moonpay", Name: "MoonPay", Type: "card", SupportedAssets: []string{"BTC", "ETH", "USDT"}, SupportedFiat: []string{"USD", "EUR", "GBP"}, MinAmount: 30, MaxAmount: 25000, FeePercent: 3.5, Enabled: true},
		{ID: "transak", Name: "Transak", Type: "card", SupportedAssets: []string{"BTC", "ETH", "USDT", "BNB"}, SupportedFiat: []string{"USD", "EUR", "GBP", "INR"}, MinAmount: 20, MaxAmount: 50000, FeePercent: 3.0, Enabled: true},
		{ID: "adyen", Name: "Adyen", Type: "bank", SupportedAssets: []string{"BTC", "ETH", "USDT"}, SupportedFiat: []string{"USD", "EUR", "GBP"}, MinAmount: 100, MaxAmount: 100000, FeePercent: 1.5, Enabled: true},
		{ID: "sepa", Name: "SEPA Transfer", Type: "bank", SupportedAssets: []string{"BTC", "ETH", "USDT"}, SupportedFiat: []string{"EUR"}, MinAmount: 100, MaxAmount: 500000, FeePercent: 0.5, Enabled: true},
		{ID: "swift", Name: "SWIFT Transfer", Type: "bank", SupportedAssets: []string{"BTC", "ETH", "USDT"}, SupportedFiat: []string{"USD", "EUR", "GBP"}, MinAmount: 1000, MaxAmount: 10000000, FeePercent: 0.3, Enabled: true},
		{ID: "pix", Name: "PIX", Type: "bank", SupportedAssets: []string{"BTC", "ETH", "USDT"}, SupportedFiat: []string{"BRL"}, MinAmount: 10, MaxAmount: 50000, FeePercent: 1.0, Enabled: true},
	}
	for _, p := range providers {
		s.providers[p.ID] = p
	}
}

func (s *Service) GetProviders() []*FiatProvider {
	result := make([]*FiatProvider, 0)
	for _, p := range s.providers {
		if p.Enabled {
			result = append(result, p)
		}
	}
	return result
}

func (s *Service) CreateDepositOrder(ctx context.Context, userID, providerID, asset, fiatCurrency string, amount float64, returnURL string) (*Order, error) {
	provider, ok := s.providers[providerID]
	if !ok {
		return nil, errors.New("provider not found")
	}
	if amount < provider.MinAmount || amount > provider.MaxAmount {
		return nil, ErrInvalidAmount
	}
	price := 45000.0
	cryptoAmount := amount / price
	fee := amount * provider.FeePercent / 100
	order := &Order{
		ID: uuid.New().String(), UserID: userID, Provider: providerID, Type: "deposit",
		Asset: asset, FiatCurrency: fiatCurrency, Amount: amount,
		CryptoAmount: cryptoAmount, Fee: fee, Status: "pending",
		ReturnURL: returnURL, CreatedAt: api.Now(), UpdatedAt: api.Now(),
	}
	s.orders[order.ID] = order
	return order, nil
}

func (s *Service) CreateWithdrawalOrder(ctx context.Context, userID, providerID, asset, fiatCurrency string, amount float64, bankAccountID string) (*Order, error) {
	provider, ok := s.providers[providerID]
	if !ok {
		return nil, errors.New("provider not found")
	}
	if amount < provider.MinAmount || amount > provider.MaxAmount {
		return nil, ErrInvalidAmount
	}
	price := 45000.0
	cryptoAmount := amount / price
	fee := amount * provider.FeePercent / 100
	order := &Order{
		ID: uuid.New().String(), UserID: userID, Provider: providerID, Type: "withdraw",
		Asset: asset, FiatCurrency: fiatCurrency, Amount: amount,
		CryptoAmount: cryptoAmount, Fee: fee, Status: "pending",
		ProviderOrderID: bankAccountID, CreatedAt: api.Now(), UpdatedAt: api.Now(),
	}
	s.orders[order.ID] = order
	return order, nil
}

func (s *Service) GetOrder(orderID string) (*Order, error) {
	order, ok := s.orders[orderID]
	if !ok {
		return nil, ErrOrderNotFound
	}
	return order, nil
}

func (s *Service) GetUserOrders(userID string) []*Order {
	result := make([]*Order, 0)
	for _, o := range s.orders {
		if o.UserID == userID {
			result = append(result, o)
		}
	}
	return result
}

func (s *Service) AddBankAccount(ctx context.Context, userID, bankName, bankCode, accountNumber, accountName, accountType, country, swift string) (*BankAccount, error) {
	account := &BankAccount{
		ID: uuid.New().String(), UserID: userID, BankName: bankName,
		BankCode: bankCode, AccountNumber: accountNumber, AccountName: accountName,
		AccountType: accountType, Country: country, Swift: swift,
		Status: "pending", CreatedAt: api.Now(),
	}
	s.bankAccounts[account.ID] = account
	return account, nil
}

func (s *Service) GetBankAccounts(userID string) []*BankAccount {
	result := make([]*BankAccount, 0)
	for _, a := range s.bankAccounts {
		if a.UserID == userID {
			result = append(result, a)
		}
	}
	return result
}

func (s *Service) AddCard(ctx context.Context, userID, last4, brand string, expMonth, expYear int) (*Card, error) {
	card := &Card{
		ID: uuid.New().String(), UserID: userID, Last4: last4,
		Brand: brand, ExpMonth: expMonth, ExpYear: expYear,
		IsDefault: false, CreatedAt: api.Now(),
	}
	s.cards[card.ID] = card
	return card, nil
}

func (s *Service) GetCards(userID string) []*Card {
	result := make([]*Card, 0)
	for _, c := range s.cards {
		if c.UserID == userID {
			result = append(result, c)
		}
	}
	return result
}

func (s *Service) GetExchangeRate(providerID, asset, fiatCurrency string, amount float64) (float64, float64, float64, error) {
	provider, ok := s.providers[providerID]
	if !ok {
		return 0, 0, 0, errors.New("provider not found")
	}
	price := 45000.0
	cryptoAmount := amount / price
	fee := amount * provider.FeePercent / 100
	total := amount + fee
	return cryptoAmount, fee, total, nil
}