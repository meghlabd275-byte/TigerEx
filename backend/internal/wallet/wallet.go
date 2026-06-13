package wallet

import (
	"fmt"
	"log"
	"sync"
	"time"
)

type WalletService struct {
	config   WalletConfig
	security SecurityLayer
	crypto  CryptoManager
	mu      sync.RWMutex
	wallets map[string]*Wallet
}

type WalletConfig struct {
	HotWalletThreshold  float64
	ColdWalletThreshold float64
	AutoReplenish    bool
}

type SecurityLayer interface {
	GetSecurityContext(r interface{}) interface{}
}

type CryptoManager interface {
	EncryptAES(data []byte) ([]byte, error)
	DecryptAES(data []byte) ([]byte, error)
	GenerateRandomBytes(length int) ([]byte, error)
}

type Wallet struct {
	UserID        string
	WalletType   WalletType
	Balances    map[string]float64
	Addresses   map[string]*Address
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type WalletType string
type Address struct {
	Address   string
	Chain     string
	Symbol    string
	Tag       string
	IsDefault bool
}

const (
	TypeSpot    WalletType = "spot"
	TypeFunding WalletType = "funding"
	TypeMargin  WalletType = "margin"
	TypeFutures WalletType = "futures"
	TypeEarn   WalletType = "earn"
)

func NewWalletService(config WalletConfig, security SecurityLayer, crypto CryptoManager) *WalletService {
	return &WalletService{
		config:   config,
		security: security,
		crypto:  crypto,
		wallets: make(map[string]*Wallet),
	}
}

func (s *WalletService) CreateWallet(userID string, walletType WalletType) (*Wallet, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	wallet := &Wallet{
		UserID:     userID,
		WalletType: walletType,
		Balances:  make(map[string]float64),
		Addresses: make(map[string]*Address),
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	key := fmt.Sprintf("%s:%s", userID, walletType)
	s.wallets[key] = wallet

	return wallet, nil
}

func (s *WalletService) GetBalance(userID string, walletType WalletType, symbol string) (float64, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	key := fmt.Sprintf("%s:%s", userID, walletType)
	wallet, exists := s.wallets[key]
	if !exists {
		return 0, fmt.Errorf("wallet not found")
	}

	return wallet.Balances[symbol], nil
}

func (s *WalletService) Deposit(userID string, walletType WalletType, symbol string, amount float64) error {
	if amount <= 0 {
		return fmt.Errorf("invalid amount")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	key := fmt.Sprintf("%s:%s", userID, walletType)
	wallet, exists := s.wallets[key]
	if !exists {
		return fmt.Errorf("wallet not found")
	}

	wallet.Balances[symbol] += amount
	wallet.UpdatedAt = time.Now()

	log.Printf("Deposit: User %s deposited %f %s", userID, amount, symbol)
	return nil
}

func (s *WalletService) Withdraw(userID string, walletType WalletType, symbol string, amount float64, toAddress string) error {
	if amount <= 0 {
		return fmt.Errorf("invalid amount")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	key := fmt.Sprintf("%s:%s", userID, walletType)
	wallet, exists := s.wallets[key]
	if !exists {
		return fmt.Errorf("wallet not found")
	}

	if wallet.Balances[symbol] < amount {
		return fmt.Errorf("insufficient balance")
	}

	wallet.Balances[symbol] -= amount
	wallet.UpdatedAt = time.Now()

	log.Printf("Withdraw: User %s withdrew %f %s to %s", userID, amount, symbol, toAddress)
	return nil
}

func (s *WalletService) Transfer(fromUser, toUser string, walletType WalletType, symbol string, amount float64) error {
	if amount <= 0 {
		return fmt.Errorf("invalid amount")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	fromKey := fmt.Sprintf("%s:%s", fromUser, walletType)
	toKey := fmt.Sprintf("%s:%s", toUser, walletType)

	fromWallet, fromExists := s.wallets[fromKey]
	toWallet, toExists := s.wallets[toKey]

	if !fromExists || !toExists {
		return fmt.Errorf("wallet not found")
	}

	if fromWallet.Balances[symbol] < amount {
		return fmt.Errorf("insufficient balance")
	}

	fromWallet.Balances[symbol] -= amount
	toWallet.Balances[symbol] += amount
	fromWallet.UpdatedAt = time.Now()
	toWallet.UpdatedAt = time.Now()

	log.Printf("Transfer: %f %s from %s to %s", amount, symbol, fromUser, toUser)
	return nil
}

func (s *WalletService) GenerateAddress(userID string, walletType WalletType, chain string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	randomBytes, err := s.crypto.GenerateRandomBytes(32)
	if err != nil {
		return "", fmt.Errorf("failed to generate address: %w", err)
	}

	address := fmt.Sprintf("0x%x", randomBytes[:20])

	key := fmt.Sprintf("%s:%s", userID, walletType)
	wallet, exists := s.wallets[key]
	if !exists {
		return "", fmt.Errorf("wallet not found")
	}

	wallet.Addresses[chain] = &Address{
		Address:   address,
		Chain:     chain,
		IsDefault: len(wallet.Addresses) == 0,
	}

	return address, nil
}

func (s *WalletService) GetAddresses(userID string, walletType WalletType) ([]*Address, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	key := fmt.Sprintf("%s:%s", userID, walletType)
	wallet, exists := s.wallets[key]
	if !exists {
		return nil, fmt.Errorf("wallet not found")
	}

	addresses := make([]*Address, 0, len(wallet.Addresses))
	for _, addr := range wallet.Addresses {
		addresses = append(addresses, addr)
	}

	return addresses, nil
}

func (s *WalletService) Shutdown() {
	log.Println("Wallet service shutdown complete")
}