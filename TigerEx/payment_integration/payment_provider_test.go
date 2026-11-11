package payment_integration

import (
	"context"
	"errors"
	"testing"
)

// The provider adapters must fail closed: a call that never reached the
// provider returns an error, never a silent (nil, nil) that a caller could
// mistake for success or dereference.

func TestStripeAdapterFailsClosed(t *testing.T) {
	sg := NewStripeGateway("k", "s")
	if _, err := sg.GetPaymentStatus(context.Background(), "p1"); !errors.Is(err, ErrProviderNotImplemented) {
		t.Fatalf("GetPaymentStatus: want ErrProviderNotImplemented, got %v", err)
	}
	if _, err := sg.ConfirmPayment(context.Background(), "p1"); !errors.Is(err, ErrProviderNotImplemented) {
		t.Fatalf("ConfirmPayment: want ErrProviderNotImplemented, got %v", err)
	}
	if err := sg.CancelPayment(context.Background(), "p1"); !errors.Is(err, ErrProviderNotImplemented) {
		t.Fatalf("CancelPayment: want ErrProviderNotImplemented, got %v", err)
	}
	if _, err := sg.RefundPayment(context.Background(), "p1", 10); !errors.Is(err, ErrProviderNotImplemented) {
		t.Fatalf("RefundPayment: want ErrProviderNotImplemented, got %v", err)
	}
}

func TestSimplexAndMoonpayAdaptersFailClosed(t *testing.T) {
	adapters := []PaymentGateway{NewSimplexGateway("k", true), NewMoonpayGateway("k", "s")}
	for _, gw := range adapters {
		if _, err := gw.GetPaymentStatus(context.Background(), "p1"); !errors.Is(err, ErrProviderNotImplemented) {
			t.Fatalf("%T GetPaymentStatus: got %v", gw, err)
		}
		if err := gw.CancelPayment(context.Background(), "p1"); !errors.Is(err, ErrProviderNotImplemented) {
			t.Fatalf("%T CancelPayment: got %v", gw, err)
		}
		if _, err := gw.RefundPayment(context.Background(), "p1", 10); !errors.Is(err, ErrProviderNotImplemented) {
			t.Fatalf("%T RefundPayment: got %v", gw, err)
		}
	}
}

// A gateway that returns (nil, nil) must not crash the service or report a
// phantom refund.
type nilResultGateway struct{}

func (nilResultGateway) CreatePayment(_ context.Context, p *Payment) (*Payment, error) { return p, nil }
func (nilResultGateway) GetPaymentStatus(_ context.Context, _ string) (*Payment, error) {
	return nil, nil
}
func (nilResultGateway) ConfirmPayment(_ context.Context, _ string) (*Payment, error) {
	return nil, nil
}
func (nilResultGateway) CancelPayment(_ context.Context, _ string) error { return nil }
func (nilResultGateway) RefundPayment(_ context.Context, _ string, _ float64) (*Payment, error) {
	return nil, nil
}
func (nilResultGateway) GetSupportedCurrencies() []string      { return []string{"USD"} }
func (nilResultGateway) GetSupportedCrypto() []string          { return []string{"BTC"} }
func (nilResultGateway) GetMinMax(_ string) (float64, float64) { return 1, 1000 }

func TestRefundWithNilGatewayResultIsRejected(t *testing.T) {
	ps := newTestService("secret")
	ps.AddGateway("nilres", nilResultGateway{})
	ps.payments["p1"] = &Payment{
		ID:      "p1",
		UserID:  "u1",
		Gateway: "nilres",
		Amount:  100,
		Status:  PaymentCompleted,
	}

	if _, err := ps.RefundPayment("p1", 50); err == nil {
		t.Fatal("a nil gateway refund result must be rejected, not dereferenced")
	}
}
