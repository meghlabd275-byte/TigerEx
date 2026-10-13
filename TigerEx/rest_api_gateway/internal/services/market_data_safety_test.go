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

func TestMarketDataNeverSynthesizesTickerOrOrderBook(t *testing.T) {
	service := NewMarketDataService()
	if _, err := service.Get24hTicker(context.Background(), "BTC/USDT"); err == nil { t.Fatal("expected unavailable ticker to fail closed") }
	if _, err := service.GetBookTicker(context.Background(), "BTC/USDT"); err == nil { t.Fatal("expected unavailable order book ticker to fail closed") }
	if _, err := service.GetDepth(context.Background(), "BTC/USDT", 10); err == nil { t.Fatal("expected unavailable depth to fail closed") }
	if _, err := service.GetRecentTrades(context.Background(), "BTC/USDT", 10); err == nil { t.Fatal("expected unavailable trades to fail closed") }
	if _, err := service.GetKlines(context.Background(), "BTC/USDT", "1m", 0, 0, 10); err == nil { t.Fatal("expected unavailable candles to fail closed") }
	if _, err := service.GetAvgPrice(context.Background(), "BTC/USDT", 5); err == nil { t.Fatal("expected unavailable average price to fail closed") }
}
