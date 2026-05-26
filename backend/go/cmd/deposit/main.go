// Package deposit - Deposit Handler
package main

import (
	"fmt"
	"time"
)

type Deposit struct {
	UserID    string
	Amount   float64
	Address  string
	Network  string
	TXHash   string
	Status   string
	Time     time.Time
}

type Handler struct {
	deposits map[string][]Deposit
}

func New() *Handler {
	return &Handler{deposits: make(map[string][]Deposit)}
}

func (h *Handler) Receive(deposit Deposit) {
	deposit.Status = "confirmed"
	h.deposits[deposit.UserID] = append(h.deposits[deposit.UserID], deposit)
}

func (h *Handler) GetHistory(userID string) []Deposit {
	return h.deposits[userID]
}

func main() {
	h := New()
	h.Receive(Deposit{
		UserID: "user1",
		Amount: 1.5,
		Address: "bc1q...",
		Network: "BTC",
		TXHash: "abc123",
	})
	fmt.Println(h.GetHistory("user1"))
}