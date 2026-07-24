// TigerEx White Label Admin System
// Built with Go for high-load worldwide distributed systems

package main

import (
"fmt"
"sync"
"time"
)

type WhiteLabelExchange struct {
ID        string
Name      string
Domain    string
Status    string
Products  []string
Config    ExchangeConfig
CreatedAt time.Time
}

type ExchangeConfig struct {
BrandName    string
Logo         string
PrimaryColor string
FeeTrading   float64
FeeWithdraw  float64
FeeDeposit   float64
}

type Pair struct {
ID        string
Base      string
Quote     string
Status    string
FeeMaker  float64
FeeTaker  float64
}

type WhiteLabelService struct {
mu       sync.RWMutex
exchanges map[string]*WhiteLabelExchange
pairs    map[string]*Pair
}

func NewWhiteLabelService() *WhiteLabelService {
return &WhiteLabelService{
exchanges: make(map[string]*WhiteLabelExchange),
pairs:    make(map[string]*Pair),
}
}

func (s *WhiteLabelService) CreateExchange(name, domain string, products []string) *WhiteLabelExchange {
s.mu.Lock()
defer s.mu.Unlock()

wl := &WhiteLabelExchange{
ID: fmt.Sprintf("WL_%d", time.Now().Unix()),
Name: name, Domain: domain,
Products: products, Status: "ACTIVE",
Config: ExchangeConfig{
BrandName: name, FeeTrading: 0.001, FeeWithdraw: 0.001, FeeDeposit: 0.0,
},
CreatedAt: time.Now(),
}
s.exchanges[wl.ID] = wl
return wl
}

func (s *WhiteLabelService) UpdateConfig(exchangeID string, config ExchangeConfig) {
s.mu.Lock()
defer s.mu.Unlock()
if e, ok := s.exchanges[exchangeID]; ok {
e.Config = config
}
}

func (s *WhiteLabelService) AddPair(exchangeID, base, quote string, maker, taker float64) {
s.mu.Lock()
defer s.mu.Unlock()

pair := &Pair{
ID: fmt.Sprintf("%s_%s", base, quote),
Base: base, Quote: quote,
Status: "ACTIVE", FeeMaker: maker, FeeTaker: taker,
}
s.pairs[pair.ID] = pair
}

func (s *WhiteLabelService) HaltPair(pairID string) {
s.mu.Lock()
defer s.mu.Unlock()
if p, ok := s.pairs[pairID]; ok {
p.Status = "HALTED"
}
}

func (s *WhiteLabelService) ResumePair(pairID string) {
s.mu.Lock()
defer s.mu.Unlock()
if p, ok := s.pairs[pairID]; ok {
p.Status = "ACTIVE"
}
}

func (s *WhiteLabelService) ImportPairsFromTigerEx() {
s.mu.Lock()
defer s.mu.Unlock()

pairs := []struct{base, quote string}{
{"BTC", "USDT"}, {"ETH", "USDT"}, {"BNB", "USDT"},
{"SOL", "USDT"}, {"XRP", "USDT"}, {"DOGE", "USDT"},
}

for _, p := range pairs {
s.pairs[p.base+"_"+p.quote] = &Pair{
ID: p.base + "_" + p.quote, Base: p.base, Quote: p.quote,
Status: "ACTIVE", FeeMaker: 0.001, FeeTaker: 0.001,
}
}
}

func (s *WhiteLabelService) GetExchange(id string) *WhiteLabelExchange {
s.mu.RLock()
defer s.mu.RUnlock()
return s.exchanges[id]
}

func (s *WhiteLabelService) GetPairs() []*Pair {
s.mu.RLock()
defer s.mu.RUnlock()
var result []*Pair
for _, p := range s.pairs { result = append(result, p) }
return result
}

func main() {
fmt.Println("TigerEx White Label Admin System")

wl := NewWhiteLabelService()

// Create exchange
ex := wl.CreateExchange("My Exchange", "myexchange.com", []string{"CEX", "DEX"})
fmt.Printf("\nCreated: %s\n", ex.Name)

// Update config
wl.UpdateConfig(ex.ID, ExchangeConfig{BrandName: "My Exchange", FeeTrading: 0.002})

// Add pairs
wl.AddPair(ex.ID, "BTC", "USDT", 0.001, 0.001)
wl.AddPair(ex.ID, "ETH", "USDT", 0.001, 0.001)

// Import from TigerEx
wl.ImportPairsFromTigerEx()

fmt.Printf("\nPairs: %d\n", len(wl.GetPairs()))
for _, p := range wl.GetPairs() {
fmt.Printf("  %s/%s: %s\n", p.Base, p.Quote, p.Status)
}

// Halt pair
wl.HaltPair("BTC_USDT")
fmt.Printf("\nHalted BTC/USDT\n")
}
