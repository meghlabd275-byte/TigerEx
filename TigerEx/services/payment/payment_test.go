package payment

import (
	"context"
	"errors"
	"testing"
)

// stubGateway is a controllable banking rail for the settlement tests.
type stubGateway struct {
	depositRef    string
	withdrawalRef string
	err           error
	calls         int
}

func (g *stubGateway) SettleDeposit(ctx context.Context, d *FiatDeposit) (string, error) {
	g.calls++
	return g.depositRef, g.err
}

func (g *stubGateway) SettleWithdrawal(ctx context.Context, w *FiatWithdrawal, a *BankAccount) (string, error) {
	g.calls++
	return g.withdrawalRef, g.err
}

func TestCompleteDepositFailsClosedWithoutGateway(t *testing.T) {
	ps := NewPaymentService()
	d, err := ps.CreateFiatDeposit("u1", 100, "usd", MethodBankTransfer)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := ps.CompleteDeposit(context.Background(), d.ID); err != ErrGatewayNotConfigured {
		t.Fatalf("expected ErrGatewayNotConfigured, got %v", err)
	}
	if d.Status == TXCompleted {
		t.Fatal("deposit must not be completed without a rail")
	}
}

func TestCompleteDepositUsesGatewayReference(t *testing.T) {
	ps := NewPaymentServiceWithGateway(&stubGateway{depositRef: "BANK-123"})
	d, err := ps.CreateFiatDeposit("u1", 100, "usd", MethodBankTransfer)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := ps.CompleteDeposit(context.Background(), d.ID); err != nil {
		t.Fatalf("complete: %v", err)
	}
	if d.Status != TXCompleted || d.BankReference != "BANK-123" {
		t.Fatalf("deposit not settled: %+v", d)
	}
}

func TestCompleteDepositGatewayErrorLeavesPending(t *testing.T) {
	ps := NewPaymentServiceWithGateway(&stubGateway{err: errors.New("rail down")})
	d, _ := ps.CreateFiatDeposit("u1", 100, "usd", MethodCard)
	if err := ps.CompleteDeposit(context.Background(), d.ID); err == nil {
		t.Fatal("expected gateway error to surface")
	}
	if d.Status == TXCompleted {
		t.Fatal("failed rail must not mark the deposit complete")
	}
}

func TestCompleteWithdrawalEmptyReferenceFails(t *testing.T) {
	ps := NewPaymentServiceWithGateway(&stubGateway{withdrawalRef: ""})
	w, err := ps.CreateFiatWithdrawal("u1", "acct-1", 500, "eur", MethodSEPA)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := ps.CompleteWithdrawal(context.Background(), w.ID); err != ErrTransactionFailed {
		t.Fatalf("expected ErrTransactionFailed, got %v", err)
	}
	if w.Status == TXCompleted {
		t.Fatal("withdrawal must not complete with no reference")
	}
}

func TestInvalidMethodRejected(t *testing.T) {
	ps := NewPaymentService()
	if _, err := ps.CreateFiatDeposit("u1", 100, "usd", PaymentMethod("crypto_magic")); err != ErrInvalidMethod {
		t.Fatalf("expected ErrInvalidMethod, got %v", err)
	}
}

func TestNonPositiveAmountRejected(t *testing.T) {
	ps := NewPaymentService()
	if _, err := ps.CreateFiatDeposit("u1", 0, "usd", MethodCard); err != ErrInvalidAmount {
		t.Fatalf("expected ErrInvalidAmount, got %v", err)
	}
}

func TestBankAccountRequiresOwner(t *testing.T) {
	ps := NewPaymentService()
	if err := ps.AddBankAccount(&BankAccount{AccountNumber: "123"}); err == nil {
		t.Fatal("bank account without an owner must be rejected")
	}
}
