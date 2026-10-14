package trading

import (
	"math"
	"testing"\n\n\t"tigerex/backend/internal/api"
)

func TestAlgoExecutionHandlerStoresValidExecutions(t *testing.T) {
	h := NewAlgoExecutionHandler()
	now := api.Now()
	twap := h.CreateTWAPExecution("user", "BTC/USDT", "buy", 10, now, now+3600, 4, 0.01)
	if twap == nil {
		t.Fatal("valid TWAP should be accepted")
	}
	if got := h.executions[twap.OrderID]; got != twap {
		t.Fatal("TWAP must be stored as the actual execution record")
	}
	vwap := h.CreateVWAPExecution("user", "BTC/USDT", "sell", 10, now, now+3600, 4, 0.01, []float64{1, 2, 3})
	if vwap == nil || h.executions[vwap.OrderID] != vwap {
		t.Fatal("valid VWAP should be stored")
	}
	iceberg := h.CreateIcebergExecution("user", "BTC/USDT", "buy", 10, 100, 2)
	if iceberg == nil || h.executions[iceberg.OrderID] != iceberg {
		t.Fatal("valid iceberg execution should be stored")
	}
}

func TestAlgoExecutionRejectsInvalidInputs(t *testing.T) {
	h := NewAlgoExecutionHandler()
	now := apiNowForTest()
	if got := h.CreateTWAPExecution("user", "BTC/USDT", "buy", 1, now, now+60, 0, 0); got != nil {
		t.Fatal("TWAP with zero slices must be rejected")
	}
	if got := h.CreateVWAPExecution("user", "BTC/USDT", "buy", 1, now, now+60, 2, 0, nil); got != nil {
		t.Fatal("VWAP without volume profile must be rejected")
	}
	if got := h.CreateIcebergExecution("user", "BTC/USDT", "buy", math.NaN(), 100, 1); got != nil {
		t.Fatal("iceberg with NaN quantity must be rejected")
	}
	if got := CreateGridBot("user", "BTC/USDT", 100, 1, 0); got != nil {
		t.Fatal("grid bot with zero levels must be rejected")
	}
}

func apiNowForTest() int64 {
	return 1_900_000_000
}
