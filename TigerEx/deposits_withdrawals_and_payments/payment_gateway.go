package main

import (
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
)

// ============================================================================
// PAYMENT GATEWAY TYPES
// ============================================================================

type PaymentMethod string

const (
	MethodBankTransfer PaymentMethod = "bank_transfer"
	MethodCard       PaymentMethod = "card"
	MethodCrypto    PaymentMethod = "crypto"
	MethodP2P       PaymentMethod = "p2p"
)

type PaymentStatus string

const (
	StatusPending    PaymentStatus = "pending"
	StatusProcessing PaymentStatus = "processing"
	StatusCompleted PaymentStatus = "completed"
	StatusFailed   PaymentStatus = "failed"
	StatusRefunded PaymentStatus = "refunded"
)

type Payment struct {
	PaymentID     string        `json:"paymentId"`
	UserID       string        `json:"userId"`
	Amount       float64       `json:"amount"`
	Currency     string        `json:"currency"`
	Method       PaymentMethod `json:"method"`
	Status       PaymentStatus `json:"status"`
	Fee          float64       `json:"fee"`
	NetAmount    float64       `json:"netAmount"`
	FromAddress string       `json:"fromAddress,omitempty"`
	ToAddress   string       `json:"toAddress,omitempty"`
	TxHash      string       `json:"txHash,omitempty"`
	Reference   string       `json:"reference"`
	Description string       `json:"description"`
	CreatedAt   int64         `json:"createdAt"`
	CompletedAt int64         `json:"completedAt,omitempty"`
}

// ============================================================================
// PAYMENT GATEWAY
// ============================================================================

type PaymentGateway struct {
	mu sync.RWMutex

	// Payments storage
	payments map[string]*Payment

	// User payments index
	userPayments map[string][]string

	// Supported methods
	supportedMethods map[PaymentMethod]bool

	// Fee configuration
	fees map[PaymentMethod]map[string]float64

	// Limits
	minAmounts map[string]float64
	maxAmounts map[string]float64

	// Metrics
	TotalDeposits   int64 `json:"totalDeposits"`
	TotalWithdrawals int64 `json:"totalWithdrawals"`
	TotalVolume    float64 `json:"totalVolume"`
}

func NewPaymentGateway() *PaymentGateway {
	return &PaymentGateway{
		payments:        make(map[string]*Payment),
		userPayments:   make(map[string][]string),
		supportedMethods: map[PaymentMethod]bool{
			MethodBankTransfer: true,
			MethodCard:       true,
			MethodCrypto:    true,
			MethodP2P:       true,
		},
		fees: map[PaymentMethod]map[string]float64{
			MethodBankTransfer: {
				"USD": 25.00,
				"EUR": 20.00,
				"GBP": 20.00,
			},
			MethodCard: {
				"USD": 2.9,
				"EUR": 2.5,
			},
			MethodCrypto: {
				"any": 1.00,
			},
			MethodP2P: {
				"any": 0,
			},
		},
		minAmounts: map[string]float64{
			"USD": 10.00,
			"EUR": 10.00,
			"GBP": 10.00,
			"BTC": 0.001,
			"ETH": 0.01,
			"USDT": 10.00,
		},
		maxAmounts: map[string]float64{
			"USD": 1000000.00,
			"EUR": 1000000.00,
			"GBP": 1000000.00,
			"BTC": 100.00,
			"ETH": 1000.00,
			"USDT": 1000000.00,
		},
	}
}

// ============================================================================
// DEPOSIT OPERATIONS
// ============================================================================

func (pg *PaymentGateway) CreateDeposit(userID, currency string, amount float64, method PaymentMethod, reference string) (*Payment, error) {
	// Validate method
	if !pg.supportedMethods[method] {
		return nil, fmt.Errorf("unsupported payment method: %s", method)
	}

	// Validate amount
	minAmt := pg.minAmounts[currency]
	if minAmt == 0 {
		minAmt = 10.0
	}

	if amount < minAmt {
		return nil, fmt.Errorf("minimum deposit is %.2f %s", minAmt, currency)
	}

	maxAmt := pg.maxAmounts[currency]
	if maxAmt == 0 {
		maxAmt = 1000000
	}

	if amount > maxAmt {
		return nil, fmt.Errorf("maximum deposit is %.2f %s", maxAmt, currency)
	}

	// Calculate fee
	fee := pg.calculateFee(method, currency, amount)

	// Create payment
	payment := &Payment{
		PaymentID:   uuid.New().String(),
		UserID:     userID,
		Amount:    amount,
		Currency:   currency,
		Method:    method,
		Status:    StatusPending,
		Fee:       fee,
		NetAmount: amount - fee,
		Reference: reference,
		CreatedAt: time.Now().UnixMilli(),
	}

	// Store
	pg.mu.Lock()
	pg.payments[payment.PaymentID] = payment
	pg.userPayments[userID] = append(pg.userPayments[userID], payment.PaymentID)
	atomic.AddInt64(&pg.TotalDeposits, 1)
	atomic.AddFloat64(&pg.TotalVolume, amount)
	pg.mu.Unlock()

	return payment, nil
}

func (pg *PaymentGateway) ConfirmDeposit(paymentID, txHash string) error {
	pg.mu.Lock()
	defer pg.mu.Unlock()

	payment, exists := pg.payments[paymentID]
	if !exists {
		return fmt.Errorf("payment not found")
	}

	if payment.Status != StatusPending {
		return fmt.Errorf("payment not pending")
	}

	payment.TxHash = txHash
	payment.Status = StatusCompleted
	payment.CompletedAt = time.Now().UnixMilli()

	return nil
}

// ============================================================================
// WITHDRAWAL OPERATIONS
// ============================================================================

func (pg *PaymentGateway) CreateWithdrawal(userID, currency, toAddress string, amount float64) (*Payment, error) {
	// Validate method
	method := MethodCrypto
	if toAddress == "" {
		method = MethodBankTransfer
	}

	if !pg.supportedMethods[method] {
		return nil, fmt.Errorf("unsupported payment method")
	}

	// Validate amount
	minAmt := pg.minAmounts[currency]
	if minAmt == 0 {
		minAmt = 10.0
	}

	if amount < minAmt {
		return nil, fmt.Errorf("minimum withdrawal is %.2f %s", minAmt, currency)
	}

	maxAmt := pg.maxAmounts[currency]
	if maxAmt == 0 {
		maxAmt = 1000000
	}

	if amount > maxAmt {
		return nil, fmt.Errorf("maximum withdrawal is %.2f %s", maxAmt, currency)
	}

	// Calculate fee
	fee := pg.calculateFee(method, currency, amount)
	netAmount := amount - fee

	if netAmount <= 0 {
		return nil, fmt.Errorf("amount too small after fees")
	}

	// Create payment
	payment := &Payment{
		PaymentID:   uuid.New().String(),
		UserID:     userID,
		Amount:    amount,
		Currency:   currency,
		Method:    method,
		Status:    StatusProcessing,
		Fee:       fee,
		NetAmount: netAmount,
		ToAddress: toAddress,
		Reference: fmt.Sprintf("WD-%d", time.Now().Unix()),
		CreatedAt: time.Now().UnixMilli(),
	}

	// Store
	pg.mu.Lock()
	pg.payments[payment.PaymentID] = payment
	pg.userPayments[userID] = append(pg.userPayments[userID], payment.PaymentID)
	atomic.AddInt64(&pg.TotalWithdrawals, 1)
	atomic.AddFloat64(&pg.TotalVolume, amount)
	pg.mu.Unlock()

	return payment, nil
}

func (pg *PaymentGateway) ConfirmWithdrawal(paymentID, txHash string) error {
	pg.mu.Lock()
	defer pg.mu.Unlock()

	payment, exists := pg.payments[paymentID]
	if !exists {
		return fmt.Errorf("payment not found")
	}

	if payment.Status != StatusProcessing {
		return fmt.Errorf("payment not processing")
	}

	payment.TxHash = txHash
	payment.Status = StatusCompleted
	payment.CompletedAt = time.Now().UnixMilli()

	return nil
}

// ============================================================================
// INTERNAL TRANSFERS
// ============================================================================

func (pg *PaymentGateway) InternalTransfer(fromUser, toUser, currency string, amount float64) (*Payment, *Payment, error) {
	if amount <= 0 {
		return nil, nil, fmt.Errorf("invalid amount")
	}

	// Create withdrawal from sender
	wdPayment := &Payment{
		PaymentID:   uuid.New().String(),
		UserID:     fromUser,
		Amount:    amount,
		Currency:   currency,
		Method:    MethodCrypto,
		Status:    StatusCompleted,
		Fee:       0,
		NetAmount: amount,
		Reference: fmt.Sprintf("INT-%d", time.Now().Unix()),
		Description: fmt.Sprintf("Transfer to %s", toUser),
		CreatedAt:  time.Now().UnixMilli(),
		CompletedAt: time.Now().UnixMilli(),
	}

	// Create deposit for receiver
	depPayment := &Payment{
		PaymentID:   uuid.New().String(),
		UserID:     toUser,
		Amount:    amount,
		Currency:   currency,
		Method:    MethodCrypto,
		Status:    StatusCompleted,
		Fee:        0,
		NetAmount: amount,
		Reference: fmt.Sprintf("INT-%d", time.Now().Unix()),
		Description: fmt.Sprintf("Transfer from %s", fromUser),
		CreatedAt:  time.Now().UnixMilli(),
		CompletedAt: time.Now().UnixMilli(),
	}

	// Store
	pg.mu.Lock()
	pg.payments[wdPayment.PaymentID] = wdPayment
	pg.payments[depPayment.PaymentID] = depPayment
	pg.userPayments[fromUser] = append(pg.userPayments[fromUser], wdPayment.PaymentID)
	pg.userPayments[toUser] = append(pg.userPayments[toUser], depPayment.PaymentID)
	atomic.AddFloat64(&pg.TotalVolume, amount*2)
	pg.mu.Unlock()

	return wdPayment, depPayment, nil
}

// ============================================================================
// HELPERS
// ============================================================================

func (pg *PaymentGateway) calculateFee(method PaymentMethod, currency string, amount float64) float64 {
	methodFees, ok := pg.fees[method]
	if !ok {
		return 0
	}

	feeRate, ok := methodFees[currency]
	if !ok {
		// Try "any"
		feeRate, ok = methodFees["any"]
		if !ok {
			return 0
		}
	}

	// Check if flat fee or percentage
	if feeRate < 1 {
		// Percentage
		return amount * feeRate / 100
	}

	// Flat fee
	return feeRate
}

func (pg *PaymentGateway) GetPayment(paymentID string) (*Payment, error) {
	pg.mu.RLock()
	defer pg.mu.RUnlock()

	payment, exists := pg.payments[paymentID]
	if !exists {
		return nil, fmt.Errorf("payment not found")
	}

	return payment, nil
}

func (pg *PaymentGateway) GetUserPayments(userID string) []*Payment {
	pg.mu.RLock()
	defer pg.mu.RUnlock()

	paymentIDs := pg.userPayments[userID]
	payments := make([]*Payment, 0, len(paymentIDs))

	for _, id := range paymentIDs {
		if payment, exists := pg.payments[id]; exists {
			payments = append(payments, payment)
		}
	}

	return payments
}

// ============================================================================
// METRICS
// ============================================================================

func (pg *PaymentGateway) GetMetrics() map[string]interface{} {
	return map[string]interface{}{
		"totalDeposits":    atomic.LoadInt64(&pg.TotalDeposits),
		"totalWithdrawals": atomic.LoadInt64(&pg.TotalWithdrawals),
		"totalVolume":    atomic.LoadFloat64(&pg.TotalVolume),
	}
}

// ============================================================================
// MAIN
// ============================================================================

func main() {
	fmt.Println("TigerEx Payment Gateway (Go)")
	fmt.Println("==============================\n")

	gateway := NewPaymentGateway()

	// Create deposit
	deposit, err := gateway.CreateDeposit("user1", "USD", 1000.00, MethodCard, "INV-2024-001")
	if err != nil {
		log.Printf("Deposit error: %v", err)
	} else {
		fmt.Printf("Deposit: %s - %.2f %s (fee: %.2f)\n", 
			deposit.PaymentID[:8], deposit.Amount, deposit.Currency, deposit.Fee)
	}

	// Confirm deposit
	gateway.ConfirmDeposit(deposit.PaymentID, "tx123abc")

	// Create withdrawal
	withdrawal, err := gateway.CreateWithdrawal("user1", "BTC", "bc1q...", 0.5)
	if err != nil {
		log.Printf("Withdrawal error: %v", err)
	} else {
		fmt.Printf("Withdrawal: %s - %.4f BTC (fee: %.4f)\n",
			withdrawal.PaymentID[:8], withdrawal.Amount, withdrawal.Fee)
	}

	// Confirm withdrawal
	gateway.ConfirmWithdrawal(withdrawal.PaymentID, "tx456def")

	// Internal transfer
	wd, dep, err := gateway.InternalTransfer("user1", "user2", "USDT", 500)
	if err != nil {
		log.Printf("Transfer error: %v", err)
	} else {
		fmt.Printf("Transfer: %s -> %s (%.2f USDT)\n",
			wd.PaymentID[:8], dep.PaymentID[:8], wd.Amount)
	}

	// Get user payments
	payments := gateway.GetUserPayments("user1")
	fmt.Printf("\nUser1 payments: %d\n", len(payments))
	for _, p := range payments {
		fmt.Printf("  %s - %s %.2f %s [%s]\n",
			p.PaymentID[:8], p.Method, p.Amount, p.Currency, p.Status)
	}

	// Get metrics
	metrics := gateway.GetMetrics()
	metricsJSON, _ := json.MarshalIndent(metrics, "", "  ")
	fmt.Printf("\nMetrics:\n%s\n", string(metricsJSON))

	fmt.Println("\nPayment gateway ready.")
}