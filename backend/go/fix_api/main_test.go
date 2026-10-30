package main

import (
	"strings"
	"testing"
)

func TestCalculateChecksumIsFIXCompliant(t *testing.T) {
	// FIX checksum is the byte sum modulo 256, not a hash.
	got := CalculateChecksum("8=FIX.4.4\x019=5\x0135=0\x01")
	want := 0
	for i := 0; i < len("8=FIX.4.4\x019=5\x0135=0\x01"); i++ {
		want += int("8=FIX.4.4\x019=5\x0135=0\x01"[i])
	}
	if got != pad(want%256) {
		t.Fatalf("checksum = %s, want %s", got, pad(want%256))
	}
	if len(got) != 3 {
		t.Fatalf("checksum %q must be zero-padded to three digits", got)
	}
}

func pad(v int) string {
	return string([]byte{
		byte('0' + (v/100)%10),
		byte('0' + (v/10)%10),
		byte('0' + v%10),
	})
}

func TestParseFIXMessageRoundTrip(t *testing.T) {
	raw := "8=FIX.4.4\x019=60\x0135=D\x0149=CLIENT1\x0156=TIGEREX\x0134=2\x01" +
		"11=ORD1\x0155=TGR/RUSD\x0154=1\x0138=2.5\x0144=100.25\x0140=2\x01" +
		"59=1\x0110=000\x01"

	msg, err := ParseFIXMessage(raw)
	if err != nil {
		t.Fatalf("parse error: %v", err)
	}
	if msg.BeginString != FIX44 {
		t.Errorf("BeginString = %q", msg.BeginString)
	}
	if msg.MsgType != MsgTypeNewOrderSingle {
		t.Errorf("MsgType = %q", msg.MsgType)
	}
	if msg.SenderCompID != "CLIENT1" || msg.TargetCompID != "TIGEREX" {
		t.Errorf("comp ids = %q/%q", msg.SenderCompID, msg.TargetCompID)
	}
	if msg.ClOrdID != "ORD1" || msg.Symbol != "TGR/RUSD" || msg.Side != SideBuy {
		t.Errorf("order fields wrong: %+v", msg)
	}
	if msg.OrderQty != 2.5 || msg.Price != 100.25 {
		t.Errorf("qty/price = %v/%v", msg.OrderQty, msg.Price)
	}

	out := msg.ToString()
	if !strings.HasPrefix(out, "8=FIX.4.4\x019=") {
		t.Errorf("serialised message must start with 8 and 9: %q", out)
	}
	if !strings.HasSuffix(out, "\x01") {
		t.Errorf("serialised message must end with SOH: %q", out)
	}

	// The body length must match the actual body and the checksum must verify.
	parts := strings.Split(strings.TrimSuffix(out, "\x01"), "\x01")
	body := strings.Join(parts[2:len(parts)-1], "\x01")
	if got := "9=" + itoa(len(body)); parts[1] != got {
		t.Errorf("body length field = %s, want %s", parts[1], got)
	}
	if CalculateChecksum(strings.Join(parts[:len(parts)-1], "\x01")+"\x01") != strings.TrimPrefix(parts[len(parts)-1], "10=") {
		t.Errorf("checksum does not verify: %q", out)
	}
}

func itoa(v int) string {
	if v == 0 {
		return "0"
	}
	var b []byte
	for v > 0 {
		b = append([]byte{byte('0' + v%10)}, b...)
		v /= 10
	}
	return string(b)
}

func TestLogonRejectsUnknownSenderAndBadSecret(t *testing.T) {
	server := NewFIXServer()
	session := server.CreateSession(FIX44, "CLIENT1", "TIGEREX", "", 30)

	// Unknown sender: no credential registered.
	bad := &FIXMessage{MsgType: MsgTypeLogon, SenderCompID: "CLIENT1", CustomFields: map[string]string{"96": "secret"}}
	resp, err := server.HandleLogon(session, bad)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.MsgType != MsgTypeReject {
		t.Fatalf("unknown sender must be rejected, got %q", resp.MsgType)
	}
	if session.IsLoggedOn {
		t.Fatal("session must not be logged on after a rejected logon")
	}

	// Register the real credential, then a wrong secret must still fail.
	if err := server.RegisterCredential("CLIENT1", "s3cret"); err != nil {
		t.Fatalf("register: %v", err)
	}
	wrong := &FIXMessage{MsgType: MsgTypeLogon, SenderCompID: "CLIENT1", CustomFields: map[string]string{"96": "wrong"}}
	resp, _ = server.HandleLogon(session, wrong)
	if resp.MsgType != MsgTypeReject {
		t.Fatalf("wrong secret must be rejected, got %q", resp.MsgType)
	}

	// Correct secret logs on.
	good := &FIXMessage{MsgType: MsgTypeLogon, MsgSeqNum: 1, SenderCompID: "CLIENT1", CustomFields: map[string]string{"96": "s3cret"}}
	resp, _ = server.HandleLogon(session, good)
	if resp.MsgType != MsgTypeLogon || !session.IsLoggedOn {
		t.Fatalf("valid logon must succeed, got %q loggedOn=%v", resp.MsgType, session.IsLoggedOn)
	}
}

func TestRegisterCredentialValidatesInput(t *testing.T) {
	server := NewFIXServer()
	if err := server.RegisterCredential("", "x"); err == nil {
		t.Fatal("empty sender must be rejected")
	}
	if err := server.RegisterCredential("C1", ""); err == nil {
		t.Fatal("empty password must be rejected")
	}
}

func TestNewOrderCreatesRealOrderState(t *testing.T) {
	server := NewFIXServer()
	session := server.CreateSession(FIX44, "CLIENT1", "TIGEREX", "", 30)
	session.IsLoggedOn = true

	msg := &FIXMessage{
		MsgType:      MsgTypeNewOrderSingle,
		ClOrdID:      "ORD1",
		Symbol:       "TGR/RUSD",
		Side:         SideBuy,
		OrderQty:     3.0,
		Price:        50.0,
		TimeInForce:  TimeInForceGTC,
		OrdType:      OrderTypeLimit,
		CustomFields: map[string]string{},
	}
	report, err := server.HandleNewOrder(session, msg)
	if err != nil {
		t.Fatalf("new order: %v", err)
	}
	if report.MsgType != MsgTypeExecutionReport {
		t.Fatalf("expected execution report, got %q", report.MsgType)
	}
	if report.OrdStatus != OrdStatusNew || report.LeavesQty != 3.0 || report.CumQty != 0 {
		t.Fatalf("unexpected new-order state: %+v", report)
	}

	order, found := server.LookupOrder(report.OrderID, "ORD1")
	if !found {
		t.Fatal("order was not persisted")
	}
	if order.Symbol != "TGR/RUSD" || order.Price != 50.0 {
		t.Fatalf("persisted order wrong: %+v", order)
	}

	// Order status must reflect the stored order, not a constant.
	status, _ := server.HandleOrderStatus(session, &FIXMessage{
		MsgType: MsgTypeOrderStatusRequest, ClOrdID: "ORD1", CustomFields: map[string]string{},
	})
	if status.OrderQty != 3.0 || status.Price != 50.0 || status.OrdStatus != OrdStatusNew {
		t.Fatalf("order status not derived from stored state: %+v", status)
	}

	// Unknown order must be rejected.
	unknown, _ := server.HandleOrderStatus(session, &FIXMessage{
		MsgType: MsgTypeOrderStatusRequest, ClOrdID: "NOPE", CustomFields: map[string]string{},
	})
	if unknown.MsgType != MsgTypeReject {
		t.Fatalf("unknown order status must be rejected, got %q", unknown.MsgType)
	}
}

func TestNewOrderValidatesRequiredFields(t *testing.T) {
	server := NewFIXServer()
	session := server.CreateSession(FIX44, "CLIENT1", "TIGEREX", "", 30)
	session.IsLoggedOn = true

	cases := []*FIXMessage{
		{Symbol: "", Side: SideBuy, OrderQty: 1, CustomFields: map[string]string{}},
		{Symbol: "TGR/RUSD", Side: "", OrderQty: 1, CustomFields: map[string]string{}},
		{Symbol: "TGR/RUSD", Side: SideBuy, OrderQty: 0, CustomFields: map[string]string{}},
	}
	for i, msg := range cases {
		msg.MsgType = MsgTypeNewOrderSingle
		resp, _ := server.HandleNewOrder(session, msg)
		if resp.MsgType != MsgTypeReject {
			t.Errorf("case %d: expected reject, got %q", i, resp.MsgType)
		}
	}
}

func TestOrderCancelTransitionsStoredOrder(t *testing.T) {
	server := NewFIXServer()
	session := server.CreateSession(FIX44, "CLIENT1", "TIGEREX", "", 30)
	session.IsLoggedOn = true

	report, _ := server.HandleNewOrder(session, &FIXMessage{
		MsgType: MsgTypeNewOrderSingle, ClOrdID: "ORD1", Symbol: "TGR/RUSD",
		Side: SideBuy, OrderQty: 2.0, Price: 10.0, CustomFields: map[string]string{},
	})

	resp, err := server.HandleOrderCancel(session, &FIXMessage{
		MsgType: MsgTypeOrderCancelRequest, OrigClOrdID: "ORD1", CustomFields: map[string]string{},
	})
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if resp.OrdStatus != OrdStatusCancelled || resp.LeavesQty != 0 {
		t.Fatalf("cancel must transition the order: %+v", resp)
	}

	order, _ := server.LookupOrder(report.OrderID, "ORD1")
	if order.OrdStatus != OrdStatusCancelled || order.LeavesQty != 0 {
		t.Fatalf("stored order not cancelled: %+v", order)
	}

	// Cancelling an unknown order must be rejected, not silently accepted.
	reject, _ := server.HandleOrderCancel(session, &FIXMessage{
		MsgType: MsgTypeOrderCancelRequest, OrigClOrdID: "MISSING", CustomFields: map[string]string{},
	})
	if reject.OrdStatus != OrdStatusRejected {
		t.Fatalf("unknown cancel must be rejected, got %q", reject.OrdStatus)
	}
}

func TestNotLoggedOnRejectsOrderFlow(t *testing.T) {
	server := NewFIXServer()
	session := server.CreateSession(FIX44, "CLIENT1", "TIGEREX", "", 30)

	for _, msg := range []*FIXMessage{
		{MsgType: MsgTypeNewOrderSingle, Symbol: "TGR/RUSD", Side: SideBuy, OrderQty: 1, CustomFields: map[string]string{}},
		{MsgType: MsgTypeOrderCancelRequest, CustomFields: map[string]string{}},
		{MsgType: MsgTypeOrderStatusRequest, CustomFields: map[string]string{}},
	} {
		var resp *FIXMessage
		var err error
		switch msg.MsgType {
		case MsgTypeNewOrderSingle:
			resp, err = server.HandleNewOrder(session, msg)
		case MsgTypeOrderCancelRequest:
			resp, err = server.HandleOrderCancel(session, msg)
		case MsgTypeOrderStatusRequest:
			resp, err = server.HandleOrderStatus(session, msg)
		}
		if err != nil {
			t.Fatalf("%s: %v", msg.MsgType, err)
		}
		if resp.MsgType != MsgTypeReject {
			t.Errorf("%s before logon must be rejected, got %q", msg.MsgType, resp.MsgType)
		}
	}
}
