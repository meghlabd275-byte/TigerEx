// Package matcher - Order Matching Engine
package main

import (
	"fmt"
	"sort"
)

type Side string

const (
	Buy  Side = "buy"
	Sell Side = "sell"
)

type Order struct {
	ID       string
	Symbol  string
	Side    Side
	Price   float64
	Quantity int
	Status  string
}

type PriceLevel struct {
	Price    float64
	Orders   []Order
}

type Book struct {
	Bids    []PriceLevel
	Asks    []PriceLevel
}

func New() *Book {
	return &Book{}
}

func (b *Book) Add(order Order) {
	if order.Side == Buy {
		b.Bids = append(b.Bids, PriceLevel{Price: order.Price, Orders: []Order{order}})
	} else {
		b.Asks = append(b.Asks, PriceLevel{Price: order.Price, Orders: []Order{order}})
	}
	b.sortBook()
}

func (b *Book) sortBook() {
	sort.Slice(b.Bids, func(i, j int) bool {
		return b.Bids[i].Price > b.Bids[j].Price
	})
	sort.Slice(b.Asks, func(i, j int) bool {
		return b.Asks[i].Price < b.Asks[j].Price
	})
}

func (b *Book) Match() []Trade {
	var trades []Trade
	
	for len(b.Bids) > 0 && len(b.Asks) > 0 {
		bid := &b.Bids[len(b.Bids)-1]
		ask := &b.Asks[len(b.Asks)-1]
		
		if bid.Price >= ask.Price {
			trade := Trade{
				Price:   ask.Price,
				Quantity: 1,
			}
			trades = append(trades, trade)
			
			bid.Orders = bid.Orders[:len(bid.Orders)-1]
			ask.Orders = ask.Orders[:len(ask.Orders)-1]
			
			if len(bid.Orders) == 0 {
				b.Bids = b.Bids[:len(b.Bids)-1]
			}
			if len(ask.Orders) == 0 {
				b.Asks = b.Asks[:len(b.Asks)-1]
			}
		} else {
			break
		}
	}
	
	return trades
}

type Trade struct {
	Price     float64
	Quantity  int
}

func main() {
	book := New()
	book.Add(Order{ID: "1", Symbol: "BTC", Side: Buy, Price: 50000, Quantity: 1})
	book.Add(Order{ID: "2", Symbol: "BTC", Side: Sell, Price: 50000, Quantity: 1})
	
	trades := book.Match()
	fmt.Printf("Matched %d trades\n", len(trades))
}