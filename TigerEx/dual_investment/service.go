// TigerEx Dual Investment Service
// Built with Go for high-load worldwide distributed systems

package main

import (
"fmt"
"sync"
"time"
)

type Product struct {
ID          string
Name        string
Underlying  string
StrikePrice float64
Settlement  float64
Duration    int // days
APY         float64
Status      string
}

type Subscription struct {
ID            string
UserID       string
ProductID    string
Side         string // "up" or "down"
Amount       float64
Settlement   float64
Status       string
CreatedAt    time.Time
SettlementAt time.Time
}

type DualInvestmentService struct {
mu        sync.RWMutex
products   map[string]*Product
subs      map[string]*Subscription
}

func New() *DualInvestmentService {
svc := &DualInvestmentService{
products: make(map[string]*Product),
subs:    make(map[string]*Subscription),
}
svc.initProducts()
return svc
}

func (s *DualInvestmentService) initProducts() {
products := []Product{
{ID: "DI_1", Name: "BTC Up 5D 5%", Underlying: "BTC", StrikePrice: 50000, Settlement: 52500, Duration: 5, APY: 0.15, Status: "ACTIVE"},
{ID: "DI_2", Name: "ETH Down 5D 5%", Underlying: "ETH", StrikePrice: 2500, Settlement: 2375, Duration: 5, APY: 0.15, Status: "ACTIVE"},
{ID: "DI_3", Name: "BTC Up 7D 8%", Underlying: "BTC", StrikePrice: 50000, Settlement: 54000, Duration: 7, APY: 0.20, Status: "ACTIVE"},
}
for _, p := range products {
s.products[p.ID] = &p
}
}

func (s *DualInvestmentService) Subscribe(userID, productID, side string, amount float64) *Subscription {
s.mu.Lock()
defer s.mu.Unlock()

product, ok := s.products[productID]
if !ok {
return nil
}

sub := &Subscription{
ID: fmt.Sprintf("SUB_%d", time.Now().UnixNano()),
UserID:    userID,
ProductID: productID,
Side:      side,
Amount:    amount,
Status:    "ACTIVE",
CreatedAt: time.Now(),
}

s.subs[sub.ID] = sub
return sub
}

func (s *DualInvestmentService) Settle(subscriptionID string, settlementPrice float64) float64 {
s.mu.Lock()
defer s.mu.Unlock()

sub, ok := s.subs[subscriptionID]
if !ok || sub.Status != "ACTIVE" {
return 0
}

product := s.products[sub.ProductID]
var payout float64

if sub.Side == "up" {
if settlementPrice >= product.Settlement {
payout = sub.Amount * (1 + product.APY)
sub.Status = "SETTLED_WON"
} else {
payout = sub.Amount
sub.Status = "SETTLED_LOST"
}
} else {
if settlementPrice <= product.Settlement {
payout = sub.Amount * (1 + product.APY)
sub.Status = "SETTLED_WON"
} else {
payout = sub.Amount
sub.Status = "SETTLED_LOST"
}
}

sub.Settlement = payout
return payout
}

func (s *DualInvestmentService) GetProducts() []*Product {
s.mu.RLock()
defer s.mu.RUnlock()

result := make([]*Product, 0)
for _, p := range s.products {
result = append(result, p)
}
return result
}

func main() {
fmt.Println("TigerEx Dual Investment Service")

svc := New()

// Get products
products := svc.GetProducts()
fmt.Printf("\nProducts: %d\n", len(products))
for _, p := range products {
fmt.Printf("  %s: %s (APY: %.1f%%)\n", p.ID, p.Name, p.APY*100)
}

// Subscribe
sub := svc.Subscribe("user1", "DI_1", "up", 1000)
fmt.Printf("\nSubscribed: %s\n", sub.ID)

// Settle
payout := svc.Settle(sub.ID, 53000)
fmt.Printf("Settlement: $%.2f\n", payout)
}
