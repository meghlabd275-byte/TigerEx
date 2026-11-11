package services

import (
	"context"
	"errors"
	"testing"

	"github.com/shopspring/decimal"
)

type stubDeriver struct {
	address string
	err     error
}

func (d *stubDeriver) DeriveAddress(ctx context.Context, userID string, chainID uint64, token string) (string, error) {
	return d.address, d.err
}

type stubProvider struct {
	tickers []*Ticker
	err     error
}

func (p *stubProvider) Ticker(ctx context.Context, symbol string) (*Ticker, error) {
	if p.err != nil {
		return nil, p.err
	}
	for _, t := range p.tickers {
		if t.Symbol == symbol {
			return t, nil
		}
	}
	return nil, errors.New("not found")
}

func (p *stubProvider) Tickers(ctx context.Context) ([]*Ticker, error) {
	return p.tickers, p.err
}

func TestCreateWalletFailsClosedWithoutDeriver(t *testing.T) {
	ws := NewWalletService()
	if _, err := ws.CreateWallet(context.Background(), "u1", 1, "ETH"); err != ErrAddressDeriverNotConfigured {
		t.Fatalf("expected ErrAddressDeriverNotConfigured, got %v", err)
	}
}

func TestCreateWalletUsesDerivedAddress(t *testing.T) {
	ws := NewWalletServiceWithDeriver(&stubDeriver{address: "0xabc"})
	w, err := ws.CreateWallet(context.Background(), "u1", 1, "ETH")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if w.Address != "0xabc" {
		t.Fatalf("address not derived: %q", w.Address)
	}
}

func TestCreateWalletRejectsEmptyDerivedAddress(t *testing.T) {
	ws := NewWalletServiceWithDeriver(&stubDeriver{address: ""})
	if _, err := ws.CreateWallet(context.Background(), "u1", 1, "ETH"); err == nil {
		t.Fatal("empty derived address must be rejected")
	}
}

func TestDebitWalletCannotOverdraw(t *testing.T) {
	ws := NewWalletServiceWithDeriver(&stubDeriver{address: "0xabc"})
	w, _ := ws.CreateWallet(context.Background(), "u1", 1, "ETH")
	if err := ws.CreditWallet(w.ID, decimal.NewFromInt(100)); err != nil {
		t.Fatalf("credit: %v", err)
	}
	if err := ws.DebitWallet(w.ID, decimal.NewFromInt(150)); err != ErrInsufficientFunds {
		t.Fatalf("expected ErrInsufficientFunds, got %v", err)
	}
	if err := ws.DebitWallet(w.ID, decimal.NewFromInt(40)); err != nil {
		t.Fatalf("debit: %v", err)
	}
	bal, _, _ := ws.GetBalance(w.ID)
	if !bal.Equal(decimal.NewFromInt(60)) {
		t.Fatalf("expected 60, got %s", bal)
	}
}

func TestMarketServiceFailsClosedWithoutProvider(t *testing.T) {
	ms := NewMarketService()
	if _, err := ms.GetTicker(context.Background(), "BTCUSDT"); err != ErrMarketDataNotConfigured {
		t.Fatalf("expected ErrMarketDataNotConfigured, got %v", err)
	}
	if _, err := ms.GetAllTickers(context.Background()); err != ErrMarketDataNotConfigured {
		t.Fatalf("expected ErrMarketDataNotConfigured, got %v", err)
	}
}

func TestMarketServiceReturnsProviderData(t *testing.T) {
	ms := NewMarketServiceWithProvider(&stubProvider{tickers: []*Ticker{{Symbol: "BTCUSDT", LastPrice: decimal.NewFromInt(50000)}}})
	tk, err := ms.GetTicker(context.Background(), "btcusdt")
	if err != nil {
		t.Fatalf("ticker: %v", err)
	}
	if tk.LastPrice.String() != "50000" {
		t.Fatalf("unexpected price %s", tk.LastPrice)
	}
}
