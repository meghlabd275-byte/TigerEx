// Package fiatgateway provides fiat payment gateway.
// Migrated from TypeScript to Go for fiat on/off ramps.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Bank account
type BankAccount struct {
	ID        string `json:"id"`
	UserID   string `json:"userId"`
	BankName string `json:"bankName"`
	AccountNum string `json:"accountNum"` // masked
	RoutingNum string `json:"routingNum"`
	Status   string `json:"status"` // active, verified
}

// Card
type Card struct {
	ID       string `json:"id"`
	UserID  string `json:"userId"`
	Last4   string `json:"last4"`
	Brand   string `json:"brand"` // Visa, Mastercard
	Type    string `json:"type"` // debit, credit
	Expires string `json:"expires"`
	Status  string `json:"status"` // active, blocked
}

// Fiat deposit
type FiatDeposit struct {
	ID          string  `json:"id"`
	UserID     string  `json:"userId"`
	MethodID   string  `json:"methodId"`
	Amount    float64 `json:"amount"`
	Currency  string  `json:"currency"`
	Status    string  `json:"status"` // pending, processing, completed
	ProcessedAt int64  `json:"processedAt"`
	CreatedAt  int64   `json:"createdAt"`
}

// Fiat withdrawal
type FiatWithdrawal struct {
	ID        string  `json:"id"`
	UserID   string  `json:"userId"`
	MethodID string  `json:"methodId"`
	Amount  float64 `json:"amount"`
	Fee     float64 `json:"fee"`
	Currency string `json:"currency"`
	Status  string  `json:"status"` // pending, processing, completed, rejected
	 ProcessedAt int64 `json:"processedAt"`
	CreatedAt  int64  `json:"createdAt"`
}

// Exchange rate
type ExchangeRate struct {
	FromCurrency string  `json:"fromCurrency"`
	ToCurrency  string  `json:"toCurrency"`
	Rate        float64 `json:"rate"`
	ExpiresAt   int64   `json:"expiresAt"`
}

// Store
type FiatGatewayStore struct {
	mu         sync.RWMutex
	bankAccounts map[string]*BankAccount
	cards       map[string]*Card
	deposits    map[string]*FiatDeposit
	withdrawals map[string]*FiatWithdrawal
	rates      map[string]*ExchangeRate
}

var (
	fgStore = &FiatGatewayStore{
		bankAccounts: make(map[string]*BankAccount),
		cards: make(map[string]*Card),
		deposits: make(map[string]*FiatDeposit),
		withdrawals: make(map[string]*FiatWithdrawal),
		rates: make(map[string]*ExchangeRate),
	}
)

// Add bank account
func AddBankAccount(account *BankAccount) *BankAccount {
	account.ID = fmt.Sprintf("bank_%d", time.Now().UnixNano())
	account.Status = "active"

	fgStore.mu.Lock()
	defer fgStore.mu.Unlock()
	fgStore.bankAccounts[account.ID] = account

	return account
}

// Add card
func AddCard(card *Card) *Card {
	card.ID = fmt.Sprintf("card_%d", time.Now().UnixNano())
	card.Status = "active"

	fgStore.mu.Lock()
	defer fgStore.mu.Unlock()
	fgStore.cards[card.ID] = card

	return card
}

// Create deposit request
func CreateDeposit(userID, methodID string, amount float64, currency string) *FiatDeposit {
	deposit := &FiatDeposit{
		ID: fmt.Sprintf("deposit_%d", time.Now().UnixNano()),
		UserID: userID,
		MethodID: methodID,
		Amount: amount,
		Currency: currency,
		Status: "pending",
		CreatedAt: time.Now().UnixMilli(),
	}

	fgStore.mu.Lock()
	defer fgStore.mu.Unlock()
	fgStore.deposits[deposit.ID] = deposit

	return deposit
}

// Process deposit
func ProcessDeposit(depositID string) error {
	fgStore.mu.Lock()
	defer fgStore.mu.Unlock()

	deposit, ok := fgStore.deposits[depositID]
	if !ok {
		return fmt.Errorf("deposit not found")
	}

	deposit.Status = "completed"
	deposit.ProcessedAt = time.Now().UnixMilli()

	return nil
}

// Create withdrawal
func CreateWithdrawal(userID, methodID string, amount float64, fee float64, currency string) (*FiatWithdrawal, error) {
	withdrawal := &FiatWithdrawal{
		ID: fmt.Sprintf("withdraw_%d", time.Now().UnixNano()),
		UserID: userID,
		MethodID: methodID,
		Amount: amount,
		Fee: fee,
		Currency: currency,
		Status: "pending",
		CreatedAt: time.Now().UnixMilli(),
	}

	fgStore.mu.Lock()
	defer fgStore.mu.Unlock()
	fgStore.withdrawals[withdrawal.ID] = withdrawal

	return withdrawal, nil
}

// Get exchange rate
func GetRate(fromCurr, toCurr string) (float64, error) {
	rate, ok := fgStore.rates[fromCurr+"_"+toCurr]
	if !ok {
		// Fallback to mock rates
		if fromCurr == "USD" && toCurr == "EUR" {
			return 0.92, nil
		}
		if fromCurr == "USD" && toCurr == "GBP" {
			return 0.79, nil
		}
		if fromCurr == "EUR" && toCurr == "USD" {
			return 1.09, nil
		}
		if fromCurr == "GBP" && toCurr == "USD" {
			return 1.27, nil
		}
		return 1.0, nil // Same currency
	}

	if rate.ExpiresAt < time.Now().UnixMilli() {
		return 0, fmt.Errorf("rate expired")
	}

	return rate.Rate, nil
}

func main() {
	fmt.Println("Fiat Gateway initialized")

	// Add bank account
	bank := AddBankAccount(&BankAccount{
		UserID: "user_001",
		BankName: "Chase",
		AccountNum: "****1234",
		RoutingNum: "021000021",
	})
	fmt.Printf("Bank added: %s %s\n", bank.BankName, bank.AccountNum)

	// Add card
	card := AddCard(&Card{
		UserID: "user_001",
		Last4: "4242",
		Brand: "Visa",
		Type: "debit",
		Expires: "12/26",
	})
	fmt.Printf("Card added: **** %s\n", card.Last4)

	// Deposit
	deposit := CreateDeposit("user_001", bank.ID, 5000, "USD")
	fmt.Printf("Deposit: $%.2f %s\n", deposit.Amount, deposit.Currency)

	ProcessDeposit(deposit.ID)
	fmt.Printf("Deposit status: %s\n", deposit.Status)

	// Rate
	rate, _ := GetRate("USD", "EUR")
	fmt.Printf("USD to EUR: %.4f\n", rate)
}