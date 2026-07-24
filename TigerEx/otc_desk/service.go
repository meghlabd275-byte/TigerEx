// TigerEx OTC Desk Service
// Built with Go for high-load distributed systems

package main

import (
"fmt"
"sync"
"time"
)

type Quote struct {
ID          string
UserID     string
Side       string
BaseAsset  string
QuoteAsset string
Amount     float64
Price      float64
Total      float64
Status     string
ValidUntil time.Time
}

type Trade struct {
ID        string
QuoteID  string
Buyer    string
Seller   string
Amount   float64
Price    float64
Total    float64
Status   string
Fee      float64
}

type OTCService struct {
mu     sync.RWMutex
quotes map[string]*Quote
trades map[string]*Trade
}

func NewOTC() *OTCService {
return &OTCService{
quotes: make(map[string]*Quote),
trades: make(map[string]*Trade),
}
}

func (s *OTCService) RequestQuote(userID, side, base, quote string, amount, price float64) *Quote {
s.mu.Lock()
defer s.mu.Unlock()

q := &Quote{
ID: fmt.Sprintf("Q_%d", time.Now().UnixNano()),
UserID: userID, Side: side,
BaseAsset: base, QuoteAsset: quote,
Amount: amount, Price: price,
Total: amount * price,
Status: "PENDING",
ValidUntil: time.Now().Add(5 * time.Minute),
}
s.quotes[q.ID] = q
return q
}

func (s *OTCService) AcceptQuote(quoteID, counterparty string) *Trade {
s.mu.Lock()
defer s.mu.Unlock()

q, ok := s.quotes[quoteID]
if !ok || q.Status != "PENDING" {
return nil
}

t := &Trade{
ID: fmt.Sprintf("T_%d", time.Now().UnixNano()),
QuoteID: quoteID,
Buyer: counterparty, Seller: q.UserID,
Amount: q.Amount, Price: q.Price,
Total: q.Total, Status: "COMPLETED",
Fee: q.Total * 0.001,
}

s.trades[t.ID] = t
q.Status = "ACCEPTED"
return t
}

func main() {
fmt.Println("TigerEx OTC Desk Service")

otc := NewOTC()

q := otc.RequestQuote("user1", "BUY", "BTC", "USDT", 10, 50000)
fmt.Printf("Quote: %s - %f BTC @ $%f\n", q.ID, q.Amount, q.Price)

t := otc.AcceptQuote(q.ID, "user2")
if t != nil {
fmt.Printf("Trade: %s - $%f (Fee: $%f)\n", t.ID, t.Total, t.Fee)
}
}
