package payment

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"testing"
)

// stubProvider is a scripted Provider for exercising the service.
type stubProvider struct {
	ref       string
	err       error
	callCount int
}

func (s *stubProvider) Settle(_ context.Context, _ *Payment, _ *CardPayment, _ *BankAccount) (string, error) {
	s.callCount++
	if s.err != nil {
		return "", s.err
	}
	return s.ref, nil
}

func newTestService() *Service {
	return NewService(&GatewayConfig{
		MinDeposit:    10,
		MaxDeposit:    100000,
		MinWithdraw:   10,
		MaxWithdraw:   100000,
		WebhookSecret: "test-webhook-secret",
	})
}

func signPayload(secret string, payload []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	return hex.EncodeToString(mac.Sum(nil))
}

// A payment must not be submitted without a provider, and must not be marked
// completed. The old code invented a reference and completed after a sleep.
func TestProcessPaymentWithoutProviderFails(t *testing.T) {
	svc := newTestService()

	payment, err := svc.CreateDeposit("user-1", MethodCard, 100, &CardPayment{Number: "4242424242424242"})
	if err != nil {
		t.Fatalf("CreateDeposit failed: %v", err)
	}

	if err := svc.ProcessPayment(payment.ID); err == nil {
		t.Fatal("ProcessPayment without a provider must fail")
	}

	got, _ := svc.GetPayment(payment.ID)
	if got.Status == StatusCompleted {
		t.Fatal("a payment must not be completed without a provider")
	}
}

// A provider error must leave the payment incomplete.
func TestProcessPaymentProviderErrorFails(t *testing.T) {
	svc := newTestService()
	svc.config.Provider = &stubProvider{err: errors.New("card declined")}

	payment, err := svc.CreateDeposit("user-1", MethodCard, 100, &CardPayment{Number: "4242424242424242"})
	if err != nil {
		t.Fatalf("CreateDeposit failed: %v", err)
	}

	if err := svc.ProcessPayment(payment.ID); err == nil {
		t.Fatal("a provider error must fail ProcessPayment")
	}

	got, _ := svc.GetPayment(payment.ID)
	if got.Status == StatusCompleted {
		t.Fatal("a declined payment must not be completed")
	}
}

// A successful submission must record the provider reference and move the
// payment to processing, not completed.
func TestProcessPaymentRecordsProviderRef(t *testing.T) {
	svc := newTestService()
	provider := &stubProvider{ref: "pi_12345"}
	svc.config.Provider = provider

	payment, err := svc.CreateDeposit("user-1", MethodCard, 100, &CardPayment{Number: "4242424242424242"})
	if err != nil {
		t.Fatalf("CreateDeposit failed: %v", err)
	}

	if err := svc.ProcessPayment(payment.ID); err != nil {
		t.Fatalf("ProcessPayment failed: %v", err)
	}

	got, _ := svc.GetPayment(payment.ID)
	if got.Status != StatusProcessing {
		t.Fatalf("expected processing, got %q", got.Status)
	}
	if got.ProviderRef != "pi_12345" {
		t.Fatalf("provider ref %q, want pi_12345", got.ProviderRef)
	}
	if provider.callCount != 1 {
		t.Fatalf("expected the provider to be called once, got %d", provider.callCount)
	}
}

// A webhook with a bad signature must be rejected.
func TestWebhookRejectsBadSignature(t *testing.T) {
	svc := newTestService()

	payment, err := svc.CreateDeposit("user-1", MethodCard, 100, &CardPayment{Number: "4242424242424242"})
	if err != nil {
		t.Fatalf("CreateDeposit failed: %v", err)
	}

	payload, _ := json.Marshal(map[string]any{
		"type": "payment.succeeded",
		"data": map[string]string{"id": payment.ID, "status": "succeeded"},
	})

	if err := svc.HandleWebhook(payload, "deadbeef"); err == nil {
		t.Fatal("a bad webhook signature must be rejected")
	}

	got, _ := svc.GetPayment(payment.ID)
	if got.Status == StatusCompleted {
		t.Fatal("a forged webhook must not complete a payment")
	}
}

// A webhook with no configured secret must be rejected, not trusted.
func TestWebhookRejectsWhenSecretMissing(t *testing.T) {
	svc := NewService(nil)
	payment, err := svc.CreateDeposit("user-1", MethodCard, 100, &CardPayment{Number: "4242424242424242"})
	if err != nil {
		t.Fatalf("CreateDeposit failed: %v", err)
	}

	payload, _ := json.Marshal(map[string]any{
		"type": "payment.succeeded",
		"data": map[string]string{"id": payment.ID, "status": "succeeded"},
	})

	if err := svc.HandleWebhook(payload, ""); err == nil {
		t.Fatal("a webhook without a configured secret must be rejected")
	}
}

// A correctly signed webhook must complete the payment.
func TestWebhookWithValidSignatureCompletes(t *testing.T) {
	svc := newTestService()

	payment, err := svc.CreateDeposit("user-1", MethodCard, 100, &CardPayment{Number: "4242424242424242"})
	if err != nil {
		t.Fatalf("CreateDeposit failed: %v", err)
	}

	payload, _ := json.Marshal(map[string]any{
		"type": "payment.succeeded",
		"data": map[string]string{"id": payment.ID, "status": "succeeded"},
	})

	if err := svc.HandleWebhook(payload, signPayload("test-webhook-secret", payload)); err != nil {
		t.Fatalf("HandleWebhook failed: %v", err)
	}

	got, _ := svc.GetPayment(payment.ID)
	if got.Status != StatusCompleted {
		t.Fatalf("expected completed, got %q", got.Status)
	}
	if !got.WebhookCalled {
		t.Fatal("a completed webhook must be recorded")
	}
}

// IBAN validation must accept real IBANs and reject malformed ones.
func TestValidIBAN(t *testing.T) {
	valid := []string{
		"DE89370400440532013000",
		"GB82WEST12345698765432",
		"FR1420041010050500013M02606",
	}
	for _, iban := range valid {
		if !ValidIBAN(iban) {
			t.Errorf("expected %s to be a valid IBAN", iban)
		}
	}

	invalid := []string{
		"",
		"DE89370400440532013001", // wrong check digits
		"DE893704004405320130",   // too short
		"1B89370400440532013000", // must start with two letters
		"DE8X370400440532013000", // non-digit check digits
	}
	for _, iban := range invalid {
		if ValidIBAN(iban) {
			t.Errorf("expected %q to be rejected", iban)
		}
	}
}

// Adding a bank account with a bad IBAN must be refused.
func TestAddBankAccountValidatesIBAN(t *testing.T) {
	svc := newTestService()

	if err := svc.AddBankAccount("user-1", &BankAccount{
		AccountNum: "12345678",
		Iban:       "DE89370400440532013001",
	}); err == nil {
		t.Fatal("a bad IBAN must be rejected")
	}

	if err := svc.AddBankAccount("user-1", &BankAccount{
		AccountNum: "12345678",
		Iban:       "DE89370400440532013000",
	}); err != nil {
		t.Fatalf("a valid IBAN must be accepted: %v", err)
	}
}

// Refund must require a provider and a completed payment.
func TestRefundRequiresCompletedPaymentAndProvider(t *testing.T) {
	svc := newTestService()

	payment, err := svc.CreateDeposit("user-1", MethodCard, 100, &CardPayment{Number: "4242424242424242"})
	if err != nil {
		t.Fatalf("CreateDeposit failed: %v", err)
	}

	// Pending: refused.
	if err := svc.Refund(payment.ID); err == nil {
		t.Fatal("a pending payment must not be refundable")
	}

	// Complete it via a signed webhook.
	payload, _ := json.Marshal(map[string]any{
		"type": "payment.succeeded",
		"data": map[string]string{"id": payment.ID, "status": "succeeded"},
	})
	if err := svc.HandleWebhook(payload, signPayload("test-webhook-secret", payload)); err != nil {
		t.Fatalf("HandleWebhook failed: %v", err)
	}

	// No provider: refused.
	if err := svc.Refund(payment.ID); err == nil {
		t.Fatal("a refund without a provider must fail")
	}

	svc.config.Provider = &stubProvider{ref: "re_1"}
	if err := svc.Refund(payment.ID); err != nil {
		t.Fatalf("Refund failed: %v", err)
	}
	got, _ := svc.GetPayment(payment.ID)
	if got.Status != StatusRefunded {
		t.Fatalf("expected refunded, got %q", got.Status)
	}
}
