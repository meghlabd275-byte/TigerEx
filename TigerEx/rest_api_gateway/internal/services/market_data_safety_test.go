package services

import (
	"context"
	"testing"
)

func TestMarketDataDoesNotSeedMockSymbolsOrPrices(t *testing.T) {
	service:=NewMarketDataService()
	symbols,err:=service.GetExchangeInfo(context.Background()); if err!=nil { t.Fatalf("GetExchangeInfo: %v",err) }
	if len(symbols)!=0 { t.Fatalf("expected no markets before live feed configuration, got %d",len(symbols)) }
	if _,err:=service.GetPrice(context.Background(),"BTC/USDT"); err==nil { t.Fatal("expected no price before live feed configuration") }
}
