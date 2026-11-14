package exchange

import (
	"context"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"testing"

	"tigerex/backend/internal/matching"
)

// engineBin locates the release matching-engine binary that CI builds with
// `cargo build --release`. Tests that need real matching are skipped when it is
// absent, so the suite still runs without a Rust toolchain.
func engineBin(t *testing.T) string {
	t.Helper()
	if p := os.Getenv("TIGEREX_TEST_ENGINE_BIN"); p != "" {
		return p
	}
	cand := filepath.Join("..", "..", "..", "rust", "matching-engine", "target", "release", "matching-engine")
	abs, err := filepath.Abs(cand)
	if err != nil {
		t.Skipf("cannot resolve engine path: %v", err)
	}
	if _, err := os.Stat(abs); err != nil {
		t.Skipf("matching engine not built (%s); run: cd backend/rust/matching-engine && cargo build --release", abs)
	}
	return abs
}

// engineStore returns a live store with a real engine child process attached.
func engineStore(t *testing.T) *Store {
	t.Helper()
	s := testStore(t)
	c, err := matching.Start(engineBin(t))
	if err != nil {
		t.Fatalf("start matching engine: %v", err)
	}
	t.Cleanup(func() { _ = c.Close() })
	store := s.WithEngine(c)
	if err := store.LoadMarketsIntoEngine(context.Background()); err != nil {
		t.Fatalf("load markets into engine: %v", err)
	}
	return store
}

// symbolSeq makes every test's market unique so a re-run never sees another
// run's resting orders in the database.
var symbolSeq int64

func uniqueSymbol(t *testing.T) string {
	t.Helper()
	symbolSeq++
	sym := fmt.Sprintf("T%d/RUSD", os.Getpid()%100000*100+int(symbolSeq)%100)
	return sym
}

func approx(t *testing.T, label string, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > 1e-9 {
		t.Fatalf("%s: got %v want %v", label, got, want)
	}
}

// TestLimitOrderMatchesAndSettlesAcrossBothUsers drives the whole path: two
// users place crossing limit orders, the real engine matches them, and the
// settlement moves real balances and withholds fees into the venue account.
func TestLimitOrderMatchesAndSettlesAcrossBothUsers(t *testing.T) {
	s := engineStore(t)
	ctx := context.Background()

	symbol := uniqueSymbol(t)
	seedMarket(t, s, symbol, "BTC", "RUSD")
	if err := s.LoadMarketsIntoEngine(ctx); err != nil {
		t.Fatalf("register market: %v", err)
	}

	buyer := freshUser(t, s)
	seller := freshUser(t, s)
	if err := s.Credit(ctx, buyer, "RUSD", "main", 100000, "seed"); err != nil {
		t.Fatalf("credit buyer: %v", err)
	}
	if err := s.Credit(ctx, seller, "BTC", "main", 10, "seed"); err != nil {
		t.Fatalf("credit seller: %v", err)
	}

	// The seller rests an ask; the buyer crosses it.
	sellOrder, err := s.PlaceOrderAndMatch(ctx, &OrderRequest{
		UserID: seller, Symbol: symbol, Side: "sell", Type: "limit", Quantity: 1, Price: 100,
	})
	if err != nil {
		t.Fatalf("place sell: %v", err)
	}
	if sellOrder.Status != "new" {
		t.Fatalf("a resting sell should be new, got %s", sellOrder.Status)
	}

	buyOrder, err := s.PlaceOrderAndMatch(ctx, &OrderRequest{
		UserID: buyer, Symbol: symbol, Side: "buy", Type: "limit", Quantity: 1, Price: 100,
	})
	if err != nil {
		t.Fatalf("place buy: %v", err)
	}
	if buyOrder.Status != "filled" {
		t.Fatalf("crossing buy should be filled, got %s", buyOrder.Status)
	}
	if buyOrder.FilledQuantity != 1 {
		t.Fatalf("buy filled quantity = %v, want 1", buyOrder.FilledQuantity)
	}

	// Buyer paid 100 RUSD, received 1 BTC less the 0.1% taker fee.
	btc, _ := s.GetBalance(ctx, buyer, "BTC")
	approx(t, "buyer BTC", btc.Available, 0.999)
	rusd, _ := s.GetBalance(ctx, buyer, "RUSD")
	approx(t, "buyer RUSD available", rusd.Available, 99900)
	approx(t, "buyer RUSD locked", rusd.Locked, 0)

	// Seller delivered 1 BTC, received 100 RUSD less the 0.1% maker fee.
	sBtc, _ := s.GetBalance(ctx, seller, "BTC")
	approx(t, "seller BTC available", sBtc.Available, 9)
	approx(t, "seller BTC locked", sBtc.Locked, 0)
	sRusd, _ := s.GetBalance(ctx, seller, "RUSD")
	approx(t, "seller RUSD", sRusd.Available, 99.9)

	// The withheld fees are backed in the venue account: 0.001 BTC and 0.1 RUSD.
	var btcFee, rusdFee float64
	if err := s.pool.QueryRow(ctx, `
		SELECT COALESCE((SELECT balance FROM exchange_treasury WHERE asset='BTC'),0)::float8,
		       COALESCE((SELECT balance FROM exchange_treasury WHERE asset='RUSD'),0)::float8`).
		Scan(&btcFee, &rusdFee); err != nil {
		t.Fatalf("read treasury: %v", err)
	}
	if btcFee < 0.001-1e-9 {
		t.Fatalf("treasury BTC fee = %v, want at least 0.001", btcFee)
	}
	if rusdFee < 0.1-1e-9 {
		t.Fatalf("treasury RUSD fee = %v, want at least 0.1", rusdFee)
	}

	// The maker's order is fully filled too.
	reloaded, err := s.GetOrder(ctx, seller, sellOrder.ID)
	if err != nil {
		t.Fatalf("reload sell: %v", err)
	}
	if reloaded.Status != "filled" {
		t.Fatalf("sell should be filled, got %s", reloaded.Status)
	}
}

// TestMarketBuyCoversSlippageFromAvailableFunds proves a market buy that fills
// above the price it reserved at draws the shortfall from available funds rather
// than failing or minting value.
func TestMarketBuyCoversSlippageFromAvailableFunds(t *testing.T) {
	s := engineStore(t)
	ctx := context.Background()

	symbol := uniqueSymbol(t)
	seedMarket(t, s, symbol, "ETH", "RUSD")
	if err := s.LoadMarketsIntoEngine(ctx); err != nil {
		t.Fatalf("register market: %v", err)
	}

	seller := freshUser(t, s)
	warmup := freshUser(t, s)
	buyer := freshUser(t, s)
	if err := s.Credit(ctx, seller, "ETH", "main", 5, "seed"); err != nil {
		t.Fatalf("credit seller ETH: %v", err)
	}
	for u, amt := range map[string]float64{warmup: 100000, buyer: 5000} {
		if err := s.Credit(ctx, u, "RUSD", "main", amt, "seed"); err != nil {
			t.Fatalf("credit RUSD: %v", err)
		}
	}

	// Rest 0.1 at 100 and 1 at 101.
	if _, err := s.PlaceOrderAndMatch(ctx, &OrderRequest{
		UserID: seller, Symbol: symbol, Side: "sell", Type: "limit", Quantity: 0.1, Price: 100,
	}); err != nil {
		t.Fatalf("rest cheap ask: %v", err)
	}
	if _, err := s.PlaceOrderAndMatch(ctx, &OrderRequest{
		UserID: seller, Symbol: symbol, Side: "sell", Type: "limit", Quantity: 1, Price: 101,
	}); err != nil {
		t.Fatalf("rest dear ask: %v", err)
	}
	// A warm-up buy sets lastPrice to 100, which sizes the market reservation.
	if _, err := s.PlaceOrderAndMatch(ctx, &OrderRequest{
		UserID: warmup, Symbol: symbol, Side: "buy", Type: "limit", Quantity: 0.1, Price: 100,
	}); err != nil {
		t.Fatalf("warmup buy: %v", err)
	}

	// The market buy reserves 100 (lastPrice) but fills 1 at 101: 101 notional.
	order, err := s.PlaceOrderAndMatch(ctx, &OrderRequest{
		UserID: buyer, Symbol: symbol, Side: "buy", Type: "market", Quantity: 1,
	})
	if err != nil {
		t.Fatalf("market buy: %v", err)
	}
	if order.Status != "filled" {
		t.Fatalf("market buy should be filled, got %s", order.Status)
	}

	rusd, _ := s.GetBalance(ctx, buyer, "RUSD")
	approx(t, "buyer RUSD after slippage", rusd.Available, 5000-101)
	approx(t, "buyer RUSD locked", rusd.Locked, 0)
	eth, _ := s.GetBalance(ctx, buyer, "ETH")
	approx(t, "buyer ETH", eth.Available, 1-0.001)
}

// TestEngineRejectionReleasesReservation proves that when the engine refuses an
// order (a market buy larger than the book) the trader's reservation is
// released and the order is marked rejected, never left locked.
func TestEngineRejectionReleasesReservation(t *testing.T) {
	s := engineStore(t)
	ctx := context.Background()

	symbol := uniqueSymbol(t)
	seedMarket(t, s, symbol, "SOL", "RUSD")
	if err := s.LoadMarketsIntoEngine(ctx); err != nil {
		t.Fatalf("register market: %v", err)
	}

	seller := freshUser(t, s)
	warmup := freshUser(t, s)
	buyer := freshUser(t, s)
	if err := s.Credit(ctx, seller, "SOL", "main", 1, "seed"); err != nil {
		t.Fatalf("credit seller: %v", err)
	}
	if err := s.Credit(ctx, warmup, "RUSD", "main", 1000, "seed"); err != nil {
		t.Fatalf("credit warmup: %v", err)
	}
	if err := s.Credit(ctx, buyer, "RUSD", "main", 10000, "seed"); err != nil {
		t.Fatalf("credit buyer: %v", err)
	}

	if _, err := s.PlaceOrderAndMatch(ctx, &OrderRequest{
		UserID: seller, Symbol: symbol, Side: "sell", Type: "limit", Quantity: 0.5, Price: 100,
	}); err != nil {
		t.Fatalf("rest ask: %v", err)
	}
	if _, err := s.PlaceOrderAndMatch(ctx, &OrderRequest{
		UserID: warmup, Symbol: symbol, Side: "buy", Type: "limit", Quantity: 0.1, Price: 100,
	}); err != nil {
		t.Fatalf("warmup buy: %v", err)
	}

	// Only 0.4 remains on the book; a 2.0 market buy must be rejected whole.
	if _, err := s.PlaceOrderAndMatch(ctx, &OrderRequest{
		UserID: buyer, Symbol: symbol, Side: "buy", Type: "market", Quantity: 2,
	}); err == nil {
		t.Fatalf("expected the engine to reject a market buy larger than the book")
	}

	// The buyer's funds must be entirely available again.
	rusd, _ := s.GetBalance(ctx, buyer, "RUSD")
	approx(t, "buyer RUSD after rejection", rusd.Available, 10000)
	approx(t, "buyer RUSD locked after rejection", rusd.Locked, 0)

	// The order is recorded as rejected, not left open.
	orders, err := s.GetOrders(ctx, buyer, symbol, "", "rejected", 10)
	if err != nil {
		t.Fatalf("get rejected orders: %v", err)
	}
	if len(orders) != 1 {
		t.Fatalf("expected 1 rejected order, got %d", len(orders))
	}
}

// TestPartiallyFilledOrderCancelReleasesOnlyRemainder proves cancelling a
// partially filled order releases exactly the unfilled reservation.
func TestPartiallyFilledOrderCancelReleasesOnlyRemainder(t *testing.T) {
	s := engineStore(t)
	ctx := context.Background()

	symbol := uniqueSymbol(t)
	seedMarket(t, s, symbol, "ADA", "RUSD")
	if err := s.LoadMarketsIntoEngine(ctx); err != nil {
		t.Fatalf("register market: %v", err)
	}

	seller := freshUser(t, s)
	buyer := freshUser(t, s)
	if err := s.Credit(ctx, seller, "ADA", "main", 10, "seed"); err != nil {
		t.Fatalf("credit seller: %v", err)
	}
	if err := s.Credit(ctx, buyer, "RUSD", "main", 1000, "seed"); err != nil {
		t.Fatalf("credit buyer: %v", err)
	}

	// Seller rests 2; a buyer takes 1, leaving the sell order half filled.
	sellOrder, err := s.PlaceOrderAndMatch(ctx, &OrderRequest{
		UserID: seller, Symbol: symbol, Side: "sell", Type: "limit", Quantity: 2, Price: 100,
	})
	if err != nil {
		t.Fatalf("rest sell: %v", err)
	}
	if _, err := s.PlaceOrderAndMatch(ctx, &OrderRequest{
		UserID: buyer, Symbol: symbol, Side: "buy", Type: "limit", Quantity: 1, Price: 100,
	}); err != nil {
		t.Fatalf("take: %v", err)
	}

	// Seller delivered 1, so 8 ADA available and 1 still reserved.
	bal, _ := s.GetBalance(ctx, seller, "ADA")
	approx(t, "seller ADA available after partial fill", bal.Available, 8)
	approx(t, "seller ADA locked after partial fill", bal.Locked, 1)

	// Cancelling releases the remaining 1 ADA and nothing more.
	if _, err := s.CancelOrder(ctx, seller, sellOrder.ID); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	bal, _ = s.GetBalance(ctx, seller, "ADA")
	approx(t, "seller ADA available after cancel", bal.Available, 9)
	approx(t, "seller ADA locked after cancel", bal.Locked, 0)
}
