// TigerEx Asset Management Service
// Built with Go for high-load worldwide distributed systems

package main

import (
"fmt"
"sync"
"time"
)

type Portfolio struct {
ID          string
UserID     string
Name       string
Holdings   map[string]float64
TotalValue float64
}

type Fund struct {
ID          string
Name       string
ManagerID  string
NAV         float64
TotalShares float64
MinInvest  float64
Status     string
}

type Investment struct {
ID        string
UserID   string
FundID   string
Amount   float64
Shares   float64
EntryNAV float64
}

type AssetService struct {
mu         sync.RWMutex
portfolios map[string]*Portfolio
funds      map[string]*Fund
investments map[string]*Investment
}

func NewAssetService() *AssetService {
svc := &AssetService{
portfolios: make(map[string]*Portfolio),
funds:      make(map[string]*Fund),
investments: make(map[string]*Investment),
}
svc.initFunds()
return svc
}

func (s *AssetService) initFunds() {
funds := []Fund{
{ID: "F_1", Name: "Crypto Growth Fund", ManagerID: "manager1", NAV: 1.05, TotalShares: 1000000, MinInvest: 1000, Status: "ACTIVE"},
{ID: "F_2", Name: "Stable Yield Fund", ManagerID: "manager1", NAV: 1.02, TotalShares: 2000000, MinInvest: 500, Status: "ACTIVE"},
{ID: "F_3", Name: "Defi Index Fund", ManagerID: "manager2", NAV: 1.08, TotalShares: 500000, MinInvest: 1000, Status: "ACTIVE"},
}
for _, f := range funds {
s.funds[f.ID] = &f
}
}

func (s *AssetService) CreatePortfolio(userID, name string) *Portfolio {
s.mu.Lock()
defer s.mu.Unlock()

p := &Portfolio{
ID: fmt.Sprintf("PF_%d", time.Now().Unix()),
UserID: userID,
Name: name,
Holdings: make(map[string]float64),
TotalValue: 0,
}
s.portfolios[p.ID] = p
return p
}

func (s *AssetService) Invest(userID, fundID string, amount float64) *Investment {
s.mu.Lock()
defer s.mu.Unlock()

fund, ok := s.funds[fundID]
if !ok || fund.Status != "ACTIVE" || amount < fund.MinInvest {
return nil
}

shares := amount / fund.NAV
inv := &Investment{
ID: fmt.Sprintf("INV_%d", time.Now().UnixNano()),
UserID: userID,
FundID: fundID,
Amount: amount,
Shares: shares,
EntryNAV: fund.NAV,
}

fund.TotalShares += shares
s.investments[inv.ID] = inv
return inv
}

func (s *AssetService) GetFunds() []*Fund {
s.mu.RLock()
defer s.mu.RUnlock()

result := make([]*Fund, 0)
for _, f := range s.funds {
result = append(result, f)
}
return result
}

func main() {
fmt.Println("TigerEx Asset Management Service")

as := NewAssetService()

// Get funds
funds := as.GetFunds()
fmt.Printf("\nFunds: %d\n", len(funds))
for _, f := range funds {
fmt.Printf("  %s: NAV $%.4f (Min: $%.0f)\n", f.Name, f.NAV, f.MinInvest)
}

// Create portfolio
pf := as.CreatePortfolio("user1", "My Portfolio")
fmt.Printf("\nPortfolio: %s\n", pf.Name)

// Invest
inv := as.Invest("user1", "F_1", 10000)
if inv != nil {
fmt.Printf("Invested: $%.2f for %.4f shares\n", inv.Amount, inv.Shares)
}
}
