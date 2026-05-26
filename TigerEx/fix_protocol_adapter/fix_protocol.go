package main

import (
	"fmt"
	"time"
)

// FIX message types
type MsgType string

const (
	MsgNewOrderSingle MsgType = "D"
	MsgOrderCancelReq MsgType = "F"
	MsgOrderReplaceReq MsgType = "G"
	MsgExecutionReport MsgType = "8"
	MsgOrderAck MsgType = "3"
	MsgOrderReject MsgType = "9"
)

// Side
type Side string

const (
	SideBuy Side = "1"
	SideSell Side = "2"
)

// FIX Order
type FIXOrder struct {
	ClOrdID    string `json:"clOrdId"`
	Symbol    string `json:"symbol"`
	Side      Side   `json:"side"`
	OrderQty  float64 `json:"orderQty"`
	Price    float64 `json:"price"`
	OrdType  string `json:"ordType"`
	TimeInForce string `json:"timeInForce"`
}

// FIX Adapter
type FIXAdapter struct {
	Orders  map[string]*FIXOrder
	Executions map[string][]*Execution
}

// New creates adapter
func NewFIXAdapter() *FIXAdapter {
	return &FIXAdapter{
		Orders: make(map[string]*FIXOrder),
		Executions: make(map[string][]*Execution),
	}
}

// Parse new order single
func (f *FIXAdapter) ParseNewOrderSingle(fields map[string]string) (*FIXOrder, error) {
	clOrdID := fields["11"]
	symbol := fields["55"]
	side := Side(fields["54"])
	
	var qty float64
	var price float64
	fmt.Sscanf(fields["38"], "%f", &qty)
	fmt.Sscanf(fields["44"], "%f", &price)
	
	order := &FIXOrder{
		ClOrdID: clOrdID,
		Symbol: symbol,
		Side: side,
		OrderQty: qty,
		Price: price,
		OrdType: fields["40"],
		TimeInForce: fields["59"],
	}
	
	f.Orders[clOrdID] = order
	return order, nil
}

// Generate execution report
func (f *FIXAdapter) GenerateExecReport(clOrdID, execType string) string {
	return fmt.Sprintf("8=9|11=%s|37=%s|17=%d|150=%s|39=2|151=0.0", 
		clOrdID, time.Now().Format("20060102150405"), time.Now().UnixNano()%100000, execType)
}

func main() {
	adapter := NewFIXAdapter()
	
	// Parse FIX message
	fields := map[string]string{
		"11": "ORDER001",
		"55": "BTC/USDT",
		"54": "1",
		"38": "0.5",
		"44": "50000",
		"40": "2",
		"59": "1",
	}
	
	order, err := adapter.ParseNewOrderSingle(fields)
	if err != nil {
		fmt.Println(err)
		return
	}
	
	fmt.Printf("Order: %s %.4f @ %.2f\n", order.Symbol, order.OrderQty, order.Price)
	
	// Generate fill
	exec := adapter.GenerateExecReport(order.ClOrdID, "F")
	fmt.Printf("Exec: %s\n", exec[:50])
}