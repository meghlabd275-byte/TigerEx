package trading

import (
	"math"
	"testing"

	"tigerex/backend/internal/api"
)

func TestSellTrailingStopTracksPeakAndWaitsForReversal(t *testing.T) {
	h := NewStopOrderHandler()
	order := &api.Order{ID: "sell-trail", Type: "trailing_stop", Side: "sell", Status: "new", TrailingDistance: 5}

	for _, sample := range []struct {
		price float64
		want  bool
	}{{100, false}, {110, false}, {106, false}, {105, true}} {
		if got := h.CheckStopOrder(order, sample.price); got != sample.want {
			t.Fatalf("price %.2f: got trigger=%v, want %v", sample.price, got, sample.want)
		}
	}
	triggered := h.TriggerStopOrder(order, 105)
	if triggered == nil || triggered.Type != "market" || triggered.Status != "triggered" || triggered.StopPrice != 105 {
		t.Fatalf("unexpected triggered sell trailing order: %#v", triggered)
	}
}

func TestBuyTrailingStopTracksTroughAndWaitsForReversal(t *testing.T) {
	h := NewStopOrderHandler()
	order := &api.Order{ID: "buy-trail", Type: "trailing_stop", Side: "buy", Status: "new", TrailingDistance: 5}

	for _, sample := range []struct {
		price float64
		want  bool
	}{{100, false}, {90, false}, {94, false}, {95, true}} {
		if got := h.CheckStopOrder(order, sample.price); got != sample.want {
			t.Fatalf("price %.2f: got trigger=%v, want %v", sample.price, got, sample.want)
		}
	}
	triggered := h.TriggerStopOrder(order, 95)
	if triggered == nil || triggered.Type != "market" || triggered.Status != "triggered" || triggered.StopPrice != 95 {
		t.Fatalf("unexpected triggered buy trailing order: %#v", triggered)
	}
}

func TestTrailingStopRejectsNonFinitePrice(t *testing.T) {
	h := NewStopOrderHandler()
	order := &api.Order{ID: "bad-price", Type: "trailing_stop", Side: "sell", TrailingDistance: 1}
	if h.CheckStopOrder(order, math.NaN()) {
		t.Fatal("NaN market price must never trigger a stop order")
	}
}
