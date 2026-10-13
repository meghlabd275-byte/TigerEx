package services

import (
	"context"
	"testing"
)

func TestCreateOrderFailsClosedWithoutExecutionPipeline(t *testing.T) {
	service:=NewTradingService()
	order,err:=service.CreateOrder(context.Background(),&CreateOrderRequest{UserID:"user-1",Symbol:"BTC/USDT",Side:"BUY",Type:"LIMIT",Price:100,Quantity:1})
	if err==nil { t.Fatal("expected execution disabled without durable matching and settlement") }
	if order!=nil { t.Fatal("must not return a fabricated order") }
}
