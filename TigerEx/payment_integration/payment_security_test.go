package payment_integration

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strconv"
	"testing"
	"time"
)

func newTestService(secret string) *PaymentService {
	ps := &PaymentService{
		gateways:        make(map[string]PaymentGateway),
		payments:        make(map[string]*Payment),
		userPayments:    make(map[string][]*Payment),
		webhookHandlers: make(map[string]func(*Payment) error),
		webhookSecret:   secret,
	}
	return ps
}

func stripeHeader(secret, body string, ts time.Time) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(strconv.FormatInt(ts.Unix(), 10)))
	mac.Write([]byte("."))
	mac.Write([]byte(body))
	return fmt.Sprintf("t=%d,v1=%s", ts.Unix(), hex.EncodeToString(mac.Sum(nil)))
}

// A forged webhook must never be accepted. The previous implementation returned
// true unconditionally, so anyone could mark a payment completed.
func TestStripeWebhookRejectsForgery(t *testing.T) {
	ps := newTestService("whsec_test_key")
	body := `{"id":"pay_1","type":"payment_completed"}`
	now := time.Now()

	if ps.verifyStripeWebhook([]byte(body), "") {
		t.Fatal("empty signature must be rejected")
	}
	if ps.verifyStripeWebhook([]byte(body), "t=1700000000,v1=deadbeef") {
		t.Fatal("garbage signature must be rejected")
	}

	// A signature made with the wrong key must be rejected.
	if ps.verifyStripeWebhook([]byte(body), stripeHeader("wrong_key", body, now)) {
		t.Fatal("signature from the wrong key must be rejected")
	}

	// A signature over a different body must be rejected.
	if ps.verifyStripeWebhook([]byte(body), stripeHeader("whsec_test_key", "other body", now)) {
		t.Fatal("signature for another body must be rejected")
	}
}

// A correctly signed webhook must be accepted.
func TestStripeWebhookAcceptsValidSignature(t *testing.T) {
	ps := newTestService("whsec_test_key")
	body := `{"id":"pay_1","type":"payment_completed"}`

	if !ps.verifyStripeWebhook([]byte(body), stripeHeader("whsec_test_key", body, time.Now())) {
		t.Fatal("a correctly signed webhook must be accepted")
	}
}

// Without a configured secret, nothing can be verified, so everything fails.
func TestWebhookFailsClosedWithoutSecret(t *testing.T) {
	ps := newTestService("")
	body := `{"id":"pay_1","type":"payment_completed"}`

	if ps.verifyStripeWebhook([]byte(body), stripeHeader("", body, time.Now())) {
		t.Fatal("with no secret configured, verification must fail")
	}
	if ps.verifyWebhook(GatewayMoonpay, []byte(body), "abc") {
		t.Fatal("with no secret configured, moonpay must fail")
	}
}

// An old captured request must not be replayable forever.
func TestStripeWebhookRejectsReplay(t *testing.T) {
	ps := newTestService("whsec_test_key")
	body := `{"id":"pay_1","type":"payment_completed"}`
	old := time.Now().Add(-1 * time.Hour)

	if ps.verifyStripeWebhook([]byte(body), stripeHeader("whsec_test_key", body, old)) {
		t.Fatal("a stale signature must be rejected")
	}
}

// An unknown gateway has no verification scheme and must never be trusted.
func TestUnknownGatewayRejected(t *testing.T) {
	ps := newTestService("whsec_test_key")
	if ps.verifyWebhook("some_other_gateway", []byte(`{"id":"x"}`), "sig") {
		t.Fatal("an unknown gateway must never verify")
	}
}

// Moonpay uses a hex HMAC over the raw body.
func TestMoonpayWebhook(t *testing.T) {
	ps := newTestService("whsec_moon")
	body := []byte(`{"id":"moon_1","type":"payment_completed"}`)

	mac := hmac.New(sha256.New, []byte("whsec_moon"))
	mac.Write(body)
	good := hex.EncodeToString(mac.Sum(nil))

	if !ps.verifyMoonpayWebhook(body, good) {
		t.Fatal("a correct moonpay signature must be accepted")
	}
	if ps.verifyMoonpayWebhook(body, "00ff") {
		t.Fatal("an incorrect moonpay signature must be rejected")
	}
}

// Banxa uses base64.
func TestBanxaWebhook(t *testing.T) {
	ps := newTestService("whsec_banxa")
	body := []byte(`{"id":"banxa_1","type":"payment_completed"}`)

	mac := hmac.New(sha256.New, []byte("whsec_banxa"))
	mac.Write(body)
	good := base64.StdEncoding.EncodeToString(mac.Sum(nil))

	if !ps.verifyBanxaWebhook(body, good) {
		t.Fatal("a correct banxa signature must be accepted")
	}
	if ps.verifyBanxaWebhook(body, "!!!not-base64!!!") {
		t.Fatal("a malformed banxa signature must be rejected")
	}
}

// Payload parsing was a no-op that always returned nil, so an event with no
// payment id silently proceeded. It must now reject such bodies.
func TestParseWebhookPayload(t *testing.T) {
	var event WebhookEvent

	if err := parseWebhookPayload([]byte(`not json`), &event); err == nil {
		t.Fatal("invalid JSON must be rejected")
	}
	if err := parseWebhookPayload([]byte(`{"type":"payment_completed"}`), &event); err == nil {
		t.Fatal("a payload with no payment id must be rejected")
	}
	if err := parseWebhookPayload([]byte(`{"id":"pay_9"}`), &event); err == nil {
		t.Fatal("a payload with no event type must be rejected")
	}

	if err := parseWebhookPayload([]byte(`{"id":"pay_9","type":"payment_completed"}`), &event); err != nil {
		t.Fatalf("a well formed payload must parse: %v", err)
	}
	if event.PaymentID != "pay_9" || event.Type != "payment_completed" {
		t.Fatalf("parsed the wrong values: %+v", event)
	}

	// Gateway variants spell the same fields differently.
	event = WebhookEvent{}
	if err := parseWebhookPayload([]byte(`{"payment_id":"p2","event_type":"payment_failed"}`), &event); err != nil {
		t.Fatalf("snake_case payload must parse: %v", err)
	}
	if event.PaymentID != "p2" || event.Type != "payment_failed" {
		t.Fatalf("snake_case parsed the wrong values: %+v", event)
	}
}

// Payment ids must be unique and must not panic on short user ids. The old code
// sliced userID[:8], which panics for a numeric id.
func TestPaymentIDsAreSafeAndUnique(t *testing.T) {
	seen := make(map[string]bool)
	for i := 0; i < 1000; i++ {
		id := newPaymentID("pay", "123") // three characters
		if seen[id] {
			t.Fatalf("duplicate payment id: %s", id)
		}
		seen[id] = true
	}

	// An empty user id must not panic either.
	_ = newPaymentID("pay", "")
	_ = newBankReference("SEPA", "1")

	refs := make(map[string]bool)
	for i := 0; i < 1000; i++ {
		ref := newBankReference("TX", "user1234")
		if refs[ref] {
			t.Fatalf("duplicate reference: %s", ref)
		}
		refs[ref] = true
	}
}

// There is no built-in rate table: without a rate source the service must
// refuse rather than invent a price.
func TestNoRateSourceIsAnError(t *testing.T) {
	ps := newTestService("s")
	if _, err := ps.getExchangeRate("USD", "BTC"); err == nil {
		t.Fatal("a missing rate source must be an error, not a guessed rate")
	}

	ps.SetRateSource(fixedRates{"BTC/USD": 50000})
	rate, err := ps.getExchangeRate("USD", "BTC")
	if err != nil {
		t.Fatalf("configured rate source must work: %v", err)
	}
	if rate != 50000 {
		t.Fatalf("wrong rate returned: %f", rate)
	}
}

type fixedRates map[string]float64

func (f fixedRates) Rate(fiat, crypto string) (float64, error) {
	key := crypto + "/" + fiat
	rate, ok := f[key]
	if !ok {
		return 0, fmt.Errorf("no rate for %s", key)
	}
	return rate, nil
}

// Luhn checksum, used to catch mistyped card numbers.
func TestLuhnValid(t *testing.T) {
	valid := []string{"4242424242424242", "5555555555554444", "378282246310005"}
	for _, card := range valid {
		if !LuhnValid(card) {
			t.Fatalf("%s should pass the Luhn check", card)
		}
	}

	invalid := []string{"4242424242424241", "1234567890123456", "abcd", "4242"}
	for _, card := range invalid {
		if LuhnValid(card) {
			t.Fatalf("%s should fail the Luhn check", card)
		}
	}
}

// Payment signatures must verify for the exact payload and fail for any change.
func TestPaymentSignatureRoundTrip(t *testing.T) {
	key := mustRSAKey(t)
	created := time.Now()

	payload := CanonicalPaymentBytes("pay_1", "user_1", "usd", 100.25, created)
	sig, err := SignPaymentPayload(payload, key)
	if err != nil {
		t.Fatalf("signing failed: %v", err)
	}
	if !VerifyPaymentPayload(payload, sig, &key.PublicKey) {
		t.Fatal("a valid signature must verify")
	}

	// Any change to amount, currency, user or id must invalidate the signature.
	tampered := CanonicalPaymentBytes("pay_1", "user_1", "usd", 999.99, created)
	if VerifyPaymentPayload(tampered, sig, &key.PublicKey) {
		t.Fatal("a signature must not verify against a different amount")
	}
	if VerifyPaymentPayload(payload, "bm90LWEtc2ln", &key.PublicKey) {
		t.Fatal("a bogus signature must not verify")
	}
	if VerifyPaymentPayload(payload, sig, nil) {
		t.Fatal("a nil key must not verify")
	}
}

// Serialization must round-trip and reject input that is not a payment.
func TestPaymentSerialization(t *testing.T) {
	p := &Payment{ID: "pay_1", UserID: "u1", Amount: 10, Currency: "USD"}
	data, err := SerializePayment(p)
	if err != nil {
		t.Fatalf("serialize failed: %v", err)
	}

	back, err := DeserializePayment(data)
	if err != nil {
		t.Fatalf("deserialize failed: %v", err)
	}
	if back.ID != p.ID || back.Amount != p.Amount {
		t.Fatalf("round trip changed the payment: %+v", back)
	}

	if _, err := DeserializePayment(`{}`); err == nil {
		t.Fatal("a payment with no id must be rejected")
	}
	if _, err := DeserializePayment(`{`); err == nil {
		t.Fatal("malformed JSON must be rejected")
	}
	if _, err := SerializePayment(nil); err == nil {
		t.Fatal("serializing nil must be an error")
	}
}
