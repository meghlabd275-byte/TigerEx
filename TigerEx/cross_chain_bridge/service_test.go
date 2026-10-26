package crosschainbridge

import (
	"fmt"
	"testing"
)

// stubClient is a chain client whose behaviour each test controls.
type stubClient struct {
	submitHash  string
	submitErr   error
	confirmHash string
	confirmErr  error

	submitCalls  int
	confirmCalls int
}

func (c *stubClient) Submit(req *BridgeRequest) (string, error) {
	c.submitCalls++
	return c.submitHash, c.submitErr
}

func (c *stubClient) Confirm(req *BridgeRequest, sourceHash string) (string, error) {
	c.confirmCalls++
	return c.confirmHash, c.confirmErr
}

func newBridged() (*BridgeService, *stubClient, *stubClient) {
	svc := NewBridgeService()
	source := &stubClient{submitHash: "0xsource", confirmHash: "0xsource"}
	target := &stubClient{submitHash: "0xtarget", confirmHash: "0xtarget"}
	svc.RegisterClient("ETH", source)
	svc.RegisterClient("BSC", target)
	return svc, source, target
}

// A transfer must not complete unless a client actually submits and confirms.
// The previous implementation marked any request COMPLETED on its own.
func TestProcessRequiresClients(t *testing.T) {
	svc := NewBridgeService() // no clients registered

	req, err := svc.CreateRequest("user1", "ETH", "BSC", "USDT", 100)
	if err != nil {
		t.Fatalf("create failed: %v", err)
	}

	if err := svc.ProcessRequest(req.ID); err == nil {
		t.Fatal("processing without a registered client must fail")
	}
	if got := svc.GetRequest(req.ID).Status; got != StatusFailed {
		t.Fatalf("a request with no client must end FAILED, got %s", got)
	}
}

// A successful transfer records the hashes the clients returned.
func TestProcessCompletesThroughClients(t *testing.T) {
	svc, source, target := newBridged()

	req, err := svc.CreateRequest("user1", "ETH", "BSC", "USDT", 100)
	if err != nil {
		t.Fatalf("create failed: %v", err)
	}

	if err := svc.ProcessRequest(req.ID); err != nil {
		t.Fatalf("processing should succeed: %v", err)
	}

	if source.submitCalls != 1 || target.confirmCalls != 1 {
		t.Fatalf("expected one submit and one confirm, got %d and %d", source.submitCalls, target.confirmCalls)
	}

	done := svc.GetRequest(req.ID)
	if done.Status != StatusCompleted {
		t.Fatalf("expected COMPLETED, got %s", done.Status)
	}
	if done.SourceHash != "0xsource" || done.TargetHash != "0xtarget" {
		t.Fatalf("hashes were not recorded: %+v", done)
	}
}

// A client failure must leave the request FAILED, never completed.
func TestProcessFailsOnClientError(t *testing.T) {
	svc := NewBridgeService()
	svc.RegisterClient("ETH", &stubClient{submitErr: fmt.Errorf("rpc down")})
	svc.RegisterClient("BSC", &stubClient{confirmHash: "0xtarget"})

	req, err := svc.CreateRequest("user1", "ETH", "BSC", "USDT", 100)
	if err != nil {
		t.Fatalf("create failed: %v", err)
	}

	if err := svc.ProcessRequest(req.ID); err == nil {
		t.Fatal("a client error must surface")
	}
	if got := svc.GetRequest(req.ID).Status; got != StatusFailed {
		t.Fatalf("expected FAILED, got %s", got)
	}
}

// A client that returns an empty hash has not really transferred anything.
func TestProcessRejectsEmptyHash(t *testing.T) {
	svc := NewBridgeService()
	svc.RegisterClient("ETH", &stubClient{submitHash: ""})
	svc.RegisterClient("BSC", &stubClient{confirmHash: "0xtarget"})

	req, _ := svc.CreateRequest("user1", "ETH", "BSC", "USDT", 100)
	if err := svc.ProcessRequest(req.ID); err == nil {
		t.Fatal("an empty source hash must fail the transfer")
	}
	if got := svc.GetRequest(req.ID).Status; got != StatusFailed {
		t.Fatalf("expected FAILED, got %s", got)
	}
}

// Validation: negative and zero amounts, unknown chains, and same-chain
// transfers must all be rejected.
func TestCreateRequestValidation(t *testing.T) {
	svc, _, _ := newBridged()

	if _, err := svc.CreateRequest("user1", "ETH", "BSC", "USDT", -5); err == nil {
		t.Fatal("a negative amount must be rejected")
	}
	if _, err := svc.CreateRequest("user1", "ETH", "BSC", "USDT", 0); err == nil {
		t.Fatal("a zero amount must be rejected")
	}
	if _, err := svc.CreateRequest("user1", "ETH", "BSC", "USDT", 10); err != nil {
		t.Fatalf("a valid request must be accepted: %v", err)
	}
	if _, err := svc.CreateRequest("user1", "DOGE", "BSC", "USDT", 10); err == nil {
		t.Fatal("an unknown source chain must be rejected")
	}
	if _, err := svc.CreateRequest("user1", "ETH", "DOGE", "USDT", 10); err == nil {
		t.Fatal("an unknown destination chain must be rejected")
	}
	if _, err := svc.CreateRequest("user1", "ETH", "ETH", "USDT", 10); err == nil {
		t.Fatal("a same-chain transfer must be rejected")
	}
	if _, err := svc.CreateRequest("", "ETH", "BSC", "USDT", 10); err == nil {
		t.Fatal("an empty user id must be rejected")
	}
	if _, err := svc.CreateRequest("user1", "ETH", "BSC", "", 10); err == nil {
		t.Fatal("an empty token must be rejected")
	}
}

// Bridge ids must be unique.
func TestRequestIDsUnique(t *testing.T) {
	svc, _, _ := newBridged()

	seen := make(map[string]bool)
	for i := 0; i < 500; i++ {
		req, err := svc.CreateRequest("user1", "ETH", "BSC", "USDT", 1)
		if err != nil {
			t.Fatalf("create failed: %v", err)
		}
		if seen[req.ID] {
			t.Fatalf("duplicate bridge id: %s", req.ID)
		}
		seen[req.ID] = true
	}
}

// A request can only be processed once.
func TestProcessIsNotIdempotent(t *testing.T) {
	svc, _, _ := newBridged()

	req, _ := svc.CreateRequest("user1", "ETH", "BSC", "USDT", 100)
	if err := svc.ProcessRequest(req.ID); err != nil {
		t.Fatalf("first process should succeed: %v", err)
	}
	if err := svc.ProcessRequest(req.ID); err == nil {
		t.Fatal("processing a completed request must fail")
	}
}
