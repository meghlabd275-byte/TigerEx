package fiatonramp

import (
	"context"
	"errors"
	"testing"
)

// stubRateProvider is a scripted RateProvider for exercising the service.
type stubRateProvider struct {
	rate float64
	err  error
}

func (s *stubRateProvider) Rate(_ context.Context, _, _ string) (float64, error) {
	if s.err != nil {
		return 0, s.err
	}
	return s.rate, nil
}

// stubProcessor is a scripted PaymentProcessor.
type stubProcessor struct {
	err       error
	callCount int
}

func (s *stubProcessor) Confirm(_ context.Context, _ *OnRampOrder) error {
	s.callCount++
	return s.err
}

func quoteReq() *QuoteRequest {
	return &QuoteRequest{
		UserID:        "user-1",
		FiatCurrency:  "USD",
		CryptoAsset:   "BTC",
		FiatAmount:    1000,
		PaymentMethod: "BANK_CARD",
	}
}

// A quote must fail when no rate provider is configured. The old code returned
// a hardcoded 50000 and reported success.
func TestQuoteWithoutRateProviderFails(t *testing.T) {
	svc := NewService()

	if _, _, err := svc.GetQuote(quoteReq()); err == nil {
		t.Fatal("a quote without a rate provider must fail")
	}
}

// A rate provider error must propagate.
func TestQuoteRateProviderErrorFails(t *testing.T) {
	svc := NewService()
	svc.SetRateProvider(&stubRateProvider{err: errors.New("feed down")})

	if _, _, err := svc.GetQuote(quoteReq()); err == nil {
		t.Fatal("a rate provider error must fail the quote")
	}
}

// A non-positive rate must be rejected rather than producing a quote.
func TestQuoteNonPositiveRateFails(t *testing.T) {
	svc := NewService()
	svc.SetRateProvider(&stubRateProvider{rate: 0})

	if _, _, err := svc.GetQuote(quoteReq()); err == nil {
		t.Fatal("a zero rate must fail the quote")
	}
}

// A configured provider must be used and its rate reflected in the output.
func TestQuoteUsesProviderRate(t *testing.T) {
	svc := NewService()
	svc.SetRateProvider(&stubRateProvider{rate: 20000})

	cryptoAmount, rate, err := svc.GetQuote(quoteReq())
	if err != nil {
		t.Fatalf("GetQuote failed: %v", err)
	}
	if rate != 20000 {
		t.Fatalf("expected the provider rate 20000, got %v", rate)
	}
	// 1000 + 2.99% fee = 1029.90, divided by 20000.
	want := 1029.90 / 20000
	if diff := cryptoAmount - want; diff > 1e-9 || diff < -1e-9 {
		t.Fatalf("crypto amount %v, want %v", cryptoAmount, want)
	}
}

// Quotes must still validate currency, amount, and payment method.
func TestQuoteValidatesInputs(t *testing.T) {
	svc := NewService()
	svc.SetRateProvider(&stubRateProvider{rate: 20000})

	req := quoteReq()
	req.CryptoAsset = ""
	if _, _, err := svc.GetQuote(req); err == nil {
		t.Fatal("a missing crypto asset must be rejected")
	}

	req = quoteReq()
	req.FiatAmount = -5
	if _, _, err := svc.GetQuote(req); err == nil {
		t.Fatal("a negative amount must be rejected")
	}

	req = quoteReq()
	req.FiatCurrency = "XYZ"
	if _, _, err := svc.GetQuote(req); err == nil {
		t.Fatal("an unsupported currency must be rejected")
	}

	req = quoteReq()
	req.PaymentMethod = "CRYPTO"
	if _, _, err := svc.GetQuote(req); err == nil {
		t.Fatal("an unsupported payment method must be rejected")
	}
}

// Completing an order without a processor must fail.
func TestCompleteOrderWithoutProcessorFails(t *testing.T) {
	svc := NewService()
	svc.SetRateProvider(&stubRateProvider{rate: 20000})

	order, err := svc.CreateOrder(quoteReq())
	if err != nil {
		t.Fatalf("CreateOrder failed: %v", err)
	}

	if err := svc.CompleteOrder(order.ID); err == nil {
		t.Fatal("completing an order without a processor must fail")
	}

	got, _ := svc.GetOrder(order.ID)
	if got.Status == OrderStatusCompleted {
		t.Fatal("an unconfirmed order must not be completed")
	}
}

// A processor error must leave the order uncompleted.
func TestCompleteOrderProcessorErrorFails(t *testing.T) {
	svc := NewService()
	svc.SetRateProvider(&stubRateProvider{rate: 20000})
	svc.SetPaymentProcessor(&stubProcessor{err: errors.New("card declined")})

	order, err := svc.CreateOrder(quoteReq())
	if err != nil {
		t.Fatalf("CreateOrder failed: %v", err)
	}

	if err := svc.CompleteOrder(order.ID); err == nil {
		t.Fatal("a processor error must fail completion")
	}

	got, _ := svc.GetOrder(order.ID)
	if got.Status == OrderStatusCompleted {
		t.Fatal("an unconfirmed order must not be completed")
	}
}

// A confirmed order may complete.
func TestCompleteOrderWithProcessorSucceeds(t *testing.T) {
	svc := NewService()
	svc.SetRateProvider(&stubRateProvider{rate: 20000})
	processor := &stubProcessor{}
	svc.SetPaymentProcessor(processor)

	order, err := svc.CreateOrder(quoteReq())
	if err != nil {
		t.Fatalf("CreateOrder failed: %v", err)
	}

	if err := svc.CompleteOrder(order.ID); err != nil {
		t.Fatalf("CompleteOrder failed: %v", err)
	}

	got, _ := svc.GetOrder(order.ID)
	if got.Status != OrderStatusCompleted {
		t.Fatalf("expected completed, got %q", got.Status)
	}
	if got.CompletedAt == nil {
		t.Fatal("a completed order must record a completion time")
	}
	if processor.callCount != 1 {
		t.Fatalf("expected the processor to be called once, got %d", processor.callCount)
	}
}

// Cancelling must only work from pending.
func TestCancelOrder(t *testing.T) {
	svc := NewService()
	svc.SetRateProvider(&stubRateProvider{rate: 20000})

	order, err := svc.CreateOrder(quoteReq())
	if err != nil {
		t.Fatalf("CreateOrder failed: %v", err)
	}
	if err := svc.CancelOrder(order.ID); err != nil {
		t.Fatalf("CancelOrder failed: %v", err)
	}
	got, _ := svc.GetOrder(order.ID)
	if got.Status != OrderStatusCancelled {
		t.Fatalf("expected cancelled, got %q", got.Status)
	}

	// A cancelled order must not be completable.
	svc.SetPaymentProcessor(&stubProcessor{})
	if err := svc.CompleteOrder(order.ID); err == nil {
		t.Fatal("a cancelled order must not be completable")
	}
}
