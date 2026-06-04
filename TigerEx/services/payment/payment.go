package payment

import (
    "errors"
    "sync"
    "time"
    "crypto/rand"
    "encoding/base64"
)

var (
    ErrInvalidAmount    = errors.New("invalid amount")
    ErrInvalidMethod    = errors.New("invalid payment method")
    ErrInsufficientBalance = errors.New("insufficient balance")
    ErrTransactionFailed = errors.New("transaction failed")
)

type PaymentMethod string

const (
    MethodBankTransfer PaymentMethod = "bank_transfer"
    MethodCard         PaymentMethod = "card"
    MethodSEPA         PaymentMethod = "sepa"
    MethodSWIFT        PaymentMethod = "swift"
    MethodP2P          PaymentMethod = "p2p"
)

type TransactionStatus string

const (
    TXPending    TransactionStatus = "pending"
    TXProcessing TransactionStatus = "processing"
    TXCompleted  TransactionStatus = "completed"
    TXFailed     TransactionStatus = "failed"
    TXCancelled  TransactionStatus = "cancelled"
)

type FiatDeposit struct {
    ID              string            `json:"id"`
    UserID          string            `json:"user_id"`
    Amount          float64           `json:"amount"`
    Currency        string            `json:"currency"`
    Method          PaymentMethod     `json:"method"`
    Status          TransactionStatus `json:"status"`
    BankReference   string            `json:"bank_reference"`
    Fees            float64           `json:"fees"`
    CreatedAt       time.Time         `json:"created_at"`
    UpdatedAt       time.Time         `json:"updated_at"`
}

type FiatWithdrawal struct {
    ID              string            `json:"id"`
    UserID          string            `json:"user_id"`
    Amount          float64           `json:"amount"`
    Currency        string            `json:"currency"`
    Method          PaymentMethod     `json:"method"`
    BankAccountID   string            `json:"bank_account_id"`
    Status          TransactionStatus `json:"status"`
    Reference       string            `json:"reference"`
    Fees            float64           `json:"fees"`
    CreatedAt       time.Time         `json:"created_at"`
    UpdatedAt       time.Time         `json:"updated_at"`
}

type BankAccount struct {
    ID               string `json:"id"`
    UserID           string `json:"user_id"`
    BankName         string `json:"bank_name"`
    AccountNumber    string `json:"account_number"`
    AccountHolder    string `json:"account_holder"`
    IBAN             string `json:"iban"`
    SWIFTCode        string `json:"swift_code"`
    IsVerified       bool   `json:"is_verified"`
    CreatedAt        time.Time `json:"created_at"`
}

type PaymentService struct {
    mu       sync.RWMutex
    deposits map[string]*FiatDeposit
    withdrawals map[string]*FiatWithdrawal
    bankAccounts map[string]*BankAccount
}

func NewPaymentService() *PaymentService {
    return &PaymentService{
        deposits: make(map[string]*FiatDeposit),
        withdrawals: make(map[string]*FiatWithdrawal),
        bankAccounts: make(map[string]*BankAccount),
    }
}

func (ps *PaymentService) CreateFiatDeposit(userID string, amount float64, currency string, method PaymentMethod) (*FiatDeposit, error) {
    if amount <= 0 {
        return nil, ErrInvalidAmount
    }
    
    ps.mu.Lock()
    defer ps.mu.Unlock()
    
    deposit := &FiatDeposit{
        ID:        generateID(),
        UserID:    userID,
        Amount:    amount,
        Currency:  currency,
        Method:    method,
        Status:    TXPending,
        Fees:      ps.calculateFees(amount, method),
        CreatedAt: time.Now(),
        UpdatedAt: time.Now(),
    }
    
    ps.deposits[deposit.ID] = deposit
    return deposit, nil
}

func (ps *PaymentService) ProcessDeposit(depositID string) error {
    ps.mu.Lock()
    defer ps.mu.Unlock()
    
    deposit, exists := ps.deposits[depositID]
    if !exists {
        return errors.New("deposit not found")
    }
    
    deposit.Status = TXProcessing
    deposit.UpdatedAt = time.Now()
    
    return nil
}

func (ps *PaymentService) CompleteDeposit(depositID string, bankReference string) error {
    ps.mu.Lock()
    defer ps.mu.Unlock()
    
    deposit, exists := ps.deposits[depositID]
    if !exists {
        return errors.New("deposit not found")
    }
    
    deposit.Status = TXCompleted
    deposit.BankReference = bankReference
    deposit.UpdatedAt = time.Now()
    
    return nil
}

func (ps *PaymentService) CreateFiatWithdrawal(userID, bankAccountID string, amount float64, currency string, method PaymentMethod) (*FiatWithdrawal, error) {
    if amount <= 0 {
        return nil, ErrInvalidAmount
    }
    
    ps.mu.Lock()
    defer ps.mu.Unlock()
    
    withdrawal := &FiatWithdrawal{
        ID:            generateID(),
        UserID:        userID,
        Amount:        amount,
        Currency:      currency,
        Method:        method,
        BankAccountID: bankAccountID,
        Status:        TXPending,
        Fees:          ps.calculateFees(amount, method),
        CreatedAt:     time.Now(),
        UpdatedAt:     time.Now(),
    }
    
    ps.withdrawals[withdrawal.ID] = withdrawal
    return withdrawal, nil
}

func (ps *PaymentService) ProcessWithdrawal(withdrawalID string) error {
    ps.mu.Lock()
    defer ps.mu.Unlock()
    
    withdrawal, exists := ps.withdrawals[withdrawalID]
    if !exists {
        return errors.New("withdrawal not found")
    }
    
    withdrawal.Status = TXProcessing
    withdrawal.UpdatedAt = time.Now()
    
    return nil
}

func (ps *PaymentService) CompleteWithdrawal(withdrawalID string, reference string) error {
    ps.mu.Lock()
    defer ps.mu.Unlock()
    
    withdrawal, exists := ps.withdrawals[withdrawalID]
    if !exists {
        return errors.New("withdrawal not found")
    }
    
    withdrawal.Status = TXCompleted
    withdrawal.Reference = reference
    withdrawal.UpdatedAt = time.Now()
    
    return nil
}

func (ps *PaymentService) CancelWithdrawal(withdrawalID string) error {
    ps.mu.Lock()
    defer ps.mu.Unlock()
    
    withdrawal, exists := ps.withdrawals[withdrawalID]
    if !exists {
        return errors.New("withdrawal not found")
    }
    
    if withdrawal.Status == TXProcessing || withdrawal.Status == TXCompleted {
        return errors.New("cannot cancel processed withdrawal")
    }
    
    withdrawal.Status = TXCancelled
    withdrawal.UpdatedAt = time.Now()
    
    return nil
}

func (ps *PaymentService) AddBankAccount(account *BankAccount) error {
    ps.mu.Lock()
    defer ps.mu.Unlock()
    
    account.ID = generateID()
    account.CreatedAt = time.Now()
    ps.bankAccounts[account.ID] = account
    
    return nil
}

func (ps *PaymentService) GetBankAccount(accountID string) (*BankAccount, error) {
    ps.mu.RLock()
    defer ps.mu.RUnlock()
    
    account, exists := ps.bankAccounts[accountID]
    if !exists {
        return nil, errors.New("bank account not found")
    }
    return account, nil
}

func (ps *PaymentService) GetUserDeposits(userID string) []*FiatDeposit {
    ps.mu.RLock()
    defer ps.mu.RUnlock()
    
    var userDeposits []*FiatDeposit
    for _, d := range ps.deposits {
        if d.UserID == userID {
            userDeposits = append(userDeposits, d)
        }
    }
    return userDeposits
}

func (ps *PaymentService) GetUserWithdrawals(userID string) []*FiatWithdrawal {
    ps.mu.RLock()
    defer ps.mu.RUnlock()
    
    var userWithdrawals []*FiatWithdrawal
    for _, w := range ps.withdrawals {
        if w.UserID == userID {
            userWithdrawals = append(userWithdrawals, w)
        }
    }
    return userWithdrawals
}

func (ps *PaymentService) calculateFees(amount float64, method PaymentMethod) float64 {
    switch method {
    case MethodCard:
        return amount * 0.029 + 0.30
    case MethodBankTransfer:
        return 25.0
    case MethodSEPA:
        return 1.50
    case MethodSWIFT:
        return 25.0
    default:
        return 0
    }
}

func generateID() string {
    b := make([]byte, 16)
    rand.Read(b)
    return base64.URLEncoding.EncodeToString(b)
}