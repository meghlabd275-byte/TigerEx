// =============================================================================
// INSTITUTIONAL CUSTODY SYSTEM
// Enterprise-grade custody and asset protection
// =============================================================================

package custody

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sync"
	"time"
)

type Config struct {
	PolicyType string
	InsuranceCoverage float64
	MultiSigThreshold int
	StorageType string
}

type Custodian struct {
	ID string
	Name string
	Address string
	Status string
	Assets float64
	Insurance float64
}

type Asset struct {
	ID string
	Name string
	Symbol string
	Balance float64
	CustodianID string
}

type Transfer struct {
	ID string
	FromCustodian string
	ToCustodian string
	AssetID string
	Amount float64
	Status string
	ApprovedBy []string
	Timestamp time.Time
}

type Policy struct {
	ID string
	Name string
	Rules []string
	Approved bool
}

type CustodyService struct {
	mu sync.RWMutex
	config Config
	custodians map[string]*Custodian
	assets map[string]*Asset
	transfers map[string]*Transfer
	policies map[string]*Policy
}

func NewCustodyService(cfg Config) *CustodyService {
	return &CustodyService{
		config: cfg,
		custodians: make(map[string]*Custodian),
		assets: make(map[string]*Asset),
		transfers: make(map[string]*Transfer),
		policies: make(map[string]*Policy),
	}
}

func (s *CustodyService) RegisterCustodian(ctx context.Context, name, address string) (*Custodian, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	custodian := &Custodian{
		ID: generateCustodianID(),
		Name: name,
		Address: address,
		Status: "active",
		Assets: 0,
		Insurance: s.config.InsuranceCoverage,
	}

	s.custodians[custodian.ID] = custodian
	return custodian, nil
}

func (s *CustodyService) AddAsset(ctx context.Context, custodianID, name, symbol string, balance float64) (*Asset, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	asset := &Asset{
		ID: generateAssetID(),
		Name: name,
		Symbol: symbol,
		Balance: balance,
		CustodianID: custodianID,
	}

	s.assets[asset.ID] = asset

	if c, ok := s.custodians[custodianID]; ok {
		c.Assets += balance
	}

	return asset, nil
}

func (s *CustodyService) InitiateTransfer(ctx context.Context, fromCustodian, toCustodian, assetID string, amount float64) (*Transfer, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	asset, ok := s.assets[assetID]
	if !ok {
		return nil, fmt.Errorf("asset not found")
	}

	if asset.Balance < amount {
		return nil, fmt.Errorf("insufficient balance")
	}

	transfer := &Transfer{
		ID: generateTransferID(),
		FromCustodian: fromCustodian,
		ToCustodian: toCustodian,
		AssetID: assetID,
		Amount: amount,
		Status: "pending",
		ApprovedBy: []string{},
		Timestamp: time.Now(),
	}

	s.transfers[transfer.ID] = transfer
	return transfer, nil
}

func (s *CustodyService) ApproveTransfer(ctx context.Context, transferID, approver string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	transfer, ok := s.transfers[transferID]
	if !ok {
		return fmt.Errorf("transfer not found")
	}

	transfer.ApprovedBy = append(transfer.ApprovedBy, approver)

	if len(transfer.ApprovedBy) >= s.config.MultiSigThreshold {
		transfer.Status = "approved"

		// Execute transfer
		if asset, ok := s.assets[transfer.AssetID]; ok {
			asset.Balance -= transfer.Amount
		}
	}

	return nil
}

func (s *CustodyService) GetCustodian(ctx context.Context, custodianID string) (*Custodian, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if c, ok := s.custodians[custodianID]; ok {
		return c, nil
	}
	return nil, fmt.Errorf("custodian not found")
}

func (s *CustodyService) GetAsset(ctx context.Context, assetID string) (*Asset, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if a, ok := s.assets[assetID]; ok {
		return a, nil
	}
	return nil, fmt.Errorf("asset not found")
}

func (s *CustodyService) GetTotalAssets() float64 {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var total float64
	for _, c := range s.custodians {
		total += c.Assets
	}
	return total
}

func generateCustodianID() string {
	return fmt.Sprintf("CUST_%x", time.Now().UnixNano())
}

func generateAssetID() string {
	return fmt.Sprintf("ASSET_%x", time.Now().UnixNano())
}

func generateTransferID() string {
	return fmt.Sprintf("XFER_%x", time.Now().UnixNano())
}

var _ = sha256.New
var _ = hex.Encode

var print = fmt.Println

func init() {
	_ = print
}

func main() {}