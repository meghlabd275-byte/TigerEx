// Package institution provides institutional services.
// Migrated from TypeScript to Go for Prime Brokerage, Custody, Desking.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Institutional account
type InstAccount struct {
	ID            string  `json:"id"`
	CompanyName  string  `json:"companyName"`
	Type        string  `json:"type"` // hedge_fund, family_office, corp_treasury
	Status      string  `json:"status"` // active, pending, suspended
	CreatedAt   int64   `json:"createdAt"`
	KYCComplete bool    `json:"kycComplete"`
}

// Sub-account
type SubAccount struct {
	ID        string `json:"id"`
	ParentID string `json:"parentId"`
	Name     string `json:"name"`
	Type     string `json:"type"` // trading, custody, funding
}

// Position report
type PositionReport struct {
	InstAccountID string  `json:"instAccountId"`
	Date        int64   `json:"date"`
	Positions  float64 `json:"positions"`
	Cash       float64 `json:"cash"`
	PnL        float64 `json:"pnl"`
	GeneratedAt int64  `json:"generatedAt"`
}

// Fee schedule
type FeeSchedule struct {
	InstitutionID string `json:"institutionId"`
	TradingFee    float64 `json:"tradingFee"` // bps
	CustodyFee    float64 `json:"custodyFee"` // bps annually
	MinCustody   float64 `json:"minCustody"` // minimum
}

// Store
type InstStore struct {
	mu          sync.RWMutex
	accounts   map[string]*InstAccount
	subAccounts map[string]*SubAccount
	reports     map[string][]*PositionReport
	fees       map[string]*FeeSchedule
}

var (
	instStore = &InstStore{
		accounts: make(map[string]*InstAccount),
		subAccounts: make(map[string]*SubAccount),
		reports: make(map[string][]*PositionReport),
		fees: make(map[string]*FeeSchedule),
	}
)

// Create institutional account
func CreateInstAccount(companyName, accountType string) *InstAccount {
	account := &InstAccount{
		ID: fmt.Sprintf("inst_%d", time.Now().UnixNano()),
		CompanyName: companyName,
		Type: accountType,
		Status: "pending",
		CreatedAt: time.Now().UnixMilli(),
		KYCComplete: false,
	}

	instStore.mu.Lock()
	defer instStore.mu.Unlock()
	instStore.accounts[account.ID] = account

	return account
}

// Approve (KYC complete)
func ApproveInstAccount(accountID string) error {
	instStore.mu.Lock()
	defer instStore.mu.Unlock()

	account, ok := instStore.accounts[accountID]
	if !ok {
		return fmt.Errorf("account not found")
	}

	account.Status = "active"
	account.KYCComplete = true

	return nil
}

// Add sub-account
func AddSubAccount(parentID, name, accountType string) *SubAccount {
	sub := &SubAccount{
		ID: fmt.Sprintf("sub_%d", time.Now().UnixNano()),
		ParentID: parentID,
		Name: name,
		Type: accountType,
	}

	instStore.mu.Lock()
	defer instStore.mu.Unlock()
	instStore.subAccounts[sub.ID] = sub

	return sub
}

// Generate daily report
func GenerateDailyReport(accountID string, positions, cash, pnl float64) *PositionReport {
	report := &PositionReport{
		InstAccountID: accountID,
		Date: time.Now().UnixMilli(),
		Positions: positions,
		Cash: cash,
		PnL: pnl,
		GeneratedAt: time.Now().UnixMilli(),
	}

	instStore.mu.Lock()
	defer instStore.mu.Unlock()
	instStore.reports[accountID] = append(instStore.reports[accountID], report)

	return report
}

// Get latest report
func GetLatestReport(accountID string) (*PositionReport, bool) {
	instStore.mu.RLock()
	defer instStore.mu.RUnlock()

	reports := instStore.reports[accountID]
	if len(reports) == 0 {
		return nil, false
	}

	return reports[len(reports)-1], true
}

// Set fee schedule
func SetFeeSchedule(accountID string, tradingFee, custodyFee, minCustody float64) error {
	fee := &FeeSchedule{
		InstitutionID: accountID,
		TradingFee: tradingFee,
		CustodyFee: custodyFee,
		MinCustody: minCustody,
	}

	instStore.mu.Lock()
	defer instStore.mu.Unlock()
	instStore.fees[accountID] = fee

	return nil
}

// Calculate fees
func CalculateFees(accountID string, tradedValue, custodyValue float64) (float64, float64, error) {
	instStore.mu.RLock()
	defer instStore.mu.RUnlock()

	fee, ok := instStore.fees[accountID]
	if !ok {
		return 0, 0, fmt.Errorf("fee schedule not found")
	}

	tradingCost := tradedValue * fee.TradingFee / 10000 // bps
	custodyCost := custodyValue * fee.CustodyFee / 10000

	if custodyCost < fee.MinCustody {
		custodyCost = fee.MinCustody
	}

	return tradingCost, custodyCost, nil
}

func main() {
	fmt.Println("Institutional Services initialized")

	// Create account
	account := CreateInstAccount("Acme Hedge Fund", "hedge_fund")
	fmt.Printf("Created: %s (%s)\n", account.CompanyName, account.Type)

	// Approve
	ApproveInstAccount(account.ID)
	fmt.Printf("Status: %s, KYC: %v\n", account.Status, account.KYCComplete)

	// Sub-accounts
	trading := AddSubAccount(account.ID, "Trading", "trading")
	custody := AddSubAccount(account.ID, "Custody", "custody")
	fmt.Printf("Sub-accounts: %s, %s\n", trading.Name, custody.Name)

	// Report
	report := GenerateDailyReport(account.ID, 5000000, 1000000, 150000)
	fmt.Printf("Daily P&L: $%.2f\n", report.PnL)

	// Fees
	SetFeeSchedule(account.ID, 0.5, 1.0, 100)
	tradingFee, custodyFee, _ := CalculateFees(account.ID, 10000000, 5000000)
	fmt.Printf("Fees: trading $%.2f, custody $%.2f\n", tradingFee, custodyFee)
}