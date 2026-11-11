package integrations

import (
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
)

func mustChain(t *testing.T, i *Integration, cfg ChainConfig) {
	t.Helper()
	if err := i.AddChain(cfg); err != nil {
		t.Fatalf("AddChain(%s): %v", cfg.Key, err)
	}
}

func fixture(t *testing.T) *Integration {
	t.Helper()
	i := New()
	mustChain(t, i, ChainConfig{
		Key: "tigersmartchain", Name: "TigerSmartChain", Type: ChainTypeEVM,
		Symbol: "TGR", Decimals: 18, RPCURL: "https://rpc.tigersmartchain.test", IsActive: true, IsNative: true,
	})
	mustChain(t, i, ChainConfig{
		Key: "ethereum", Name: "Ethereum", Type: ChainTypeEVM,
		Symbol: "ETH", Decimals: 18, RPCURL: "https://eth.test", IsActive: true,
	})
	tokens := []TokenConfig{
		{Symbol: "TGR", Name: "Tiger Coin", ChainKey: "tigersmartchain", Decimals: 18, IsNative: true},
		{Symbol: "RUSD", Name: "Royal Tiger USD", ChainKey: "tigersmartchain", Decimals: 18, IsStablecoin: true, Address: "0x1111111111111111111111111111111111111111"},
		{Symbol: "USDT", Name: "Tether USD", ChainKey: "tigersmartchain", Decimals: 6, IsStablecoin: true, Address: "0x2222222222222222222222222222222222222222"},
	}
	for _, token := range tokens {
		if err := i.AddToken(token); err != nil {
			t.Fatalf("AddToken(%s): %v", token.Symbol, err)
		}
	}
	return i
}

func TestNewIntegrationIsEmpty(t *testing.T) {
	i := New()
	if len(i.Chains()) != 0 || len(i.Pools()) != 0 {
		t.Fatal("a new integration layer must advertise nothing")
	}
	if i.Fees().Total().Sign() != 0 {
		t.Fatal("a new fee ledger must be zero")
	}
}

func TestAddChainValidatesEndpoint(t *testing.T) {
	i := New()
	base := ChainConfig{Key: "k", Name: "K", Type: ChainTypeEVM, Symbol: "K", Decimals: 18, RPCURL: "https://node.test"}
	if err := i.AddChain(base); err != nil {
		t.Fatalf("valid chain rejected: %v", err)
	}

	cases := map[string]ChainConfig{
		"blank key":    {Key: "", Name: "K", Type: ChainTypeEVM, Symbol: "K", RPCURL: "https://node.test"},
		"blank rpc":    {Key: "k2", Name: "K", Type: ChainTypeEVM, Symbol: "K", RPCURL: ""},
		"bad scheme":   {Key: "k3", Name: "K", Type: ChainTypeEVM, Symbol: "K", RPCURL: "ftp://node.test"},
		"credentials":  {Key: "k4", Name: "K", Type: ChainTypeEVM, Symbol: "K", RPCURL: "https://user:pass@node.test"},
		"unknown type": {Key: "k5", Name: "K", Type: "quantum", Symbol: "K", RPCURL: "https://node.test"},
		"blank symbol": {Key: "k6", Name: "K", Type: ChainTypeEVM, Symbol: "", RPCURL: "https://node.test"},
	}
	for name, cfg := range cases {
		if err := i.AddChain(cfg); !IsCode(err, CodeValidation) && !IsCode(err, CodeNotConfigured) {
			t.Fatalf("%s: expected a validation refusal, got %v", name, err)
		}
	}
}

func TestTokenRequiresContractAddress(t *testing.T) {
	i := fixture(t)
	// A non-native token without an address is refused.
	err := i.AddToken(TokenConfig{Symbol: "WBTC", Name: "Wrapped BTC", ChainKey: "tigersmartchain", Decimals: 8})
	if !IsCode(err, CodeValidation) {
		t.Fatalf("expected VALIDATION_FAILED, got %v", err)
	}
	// A native token needs none.
	if err := i.AddToken(TokenConfig{Symbol: "TGR2", Name: "Native", ChainKey: "tigersmartchain", Decimals: 18, IsNative: true}); err != nil {
		t.Fatalf("native token rejected: %v", err)
	}
	// A token on an unregistered chain is refused.
	if err := i.AddToken(TokenConfig{Symbol: "X", Name: "X", ChainKey: "nowhere", Decimals: 18, Address: "0x1"}); !IsCode(err, CodeNotFound) {
		t.Fatalf("expected NOT_FOUND, got %v", err)
	}
}

func TestPoolQuoteUsesConstantProduct(t *testing.T) {
	i := fixture(t)
	if _, err := i.CreatePool("TGR", "USDT", "tigersmartchain", 30); err != nil {
		t.Fatalf("CreatePool: %v", err)
	}
	// An empty pool cannot quote.
	if _, err := i.Swap("TGR", "USDT", "tigersmartchain", big.NewInt(100)); !IsCode(err, CodeInsufficient) {
		t.Fatalf("expected INSUFFICIENT_LIQUIDITY on an empty pool, got %v", err)
	}

	reserveA := big.NewInt(1_000_000)
	reserveB := big.NewInt(500_000)
	if err := i.AddLiquidity("TGR", "USDT", reserveA, reserveB); err != nil {
		t.Fatalf("AddLiquidity: %v", err)
	}

	amountIn := big.NewInt(1_000)
	pool := i.Pool("TGR", "USDT")
	quote, err := pool.Quote("TGR", amountIn)
	if err != nil {
		t.Fatalf("Quote: %v", err)
	}
	// x*y=k with the 30 bps fee taken off the input.
	fee := new(big.Int).Mul(amountIn, big.NewInt(30))
	fee.Div(fee, big.NewInt(10000))
	inAfterFee := new(big.Int).Sub(amountIn, fee)
	expected := new(big.Int).Mul(inAfterFee, reserveB)
	expected.Div(expected, new(big.Int).Add(reserveA, inAfterFee))
	if quote.Cmp(expected) != 0 {
		t.Fatalf("quote %s != expected %s", quote, expected)
	}
}

func TestSwapMovesReservesAndBooksFee(t *testing.T) {
	i := fixture(t)
	if _, err := i.CreatePool("TGR", "USDT", "tigersmartchain", 30); err != nil {
		t.Fatalf("CreatePool: %v", err)
	}
	if err := i.AddLiquidity("TGR", "USDT", big.NewInt(1_000_000), big.NewInt(500_000)); err != nil {
		t.Fatalf("AddLiquidity: %v", err)
	}
	reserveABefore := new(big.Int).Set(i.Pool("TGR", "USDT").ReserveA)
	reserveBBefore := new(big.Int).Set(i.Pool("TGR", "USDT").ReserveB)

	amountIn := big.NewInt(1_000)
	out, err := i.Swap("TGR", "USDT", "tigersmartchain", amountIn)
	if err != nil {
		t.Fatalf("Swap: %v", err)
	}
	if out.Sign() <= 0 {
		t.Fatal("swap output must be positive")
	}
	after := i.Pool("TGR", "USDT")
	if after.ReserveA.Cmp(reserveABefore) <= 0 {
		t.Fatal("token_in reserve must rise")
	}
	if after.ReserveB.Cmp(reserveBBefore) >= 0 {
		t.Fatal("token_out reserve must fall")
	}

	fees := i.Fees().TotalByType()
	dex := fees[FeeTypeDEX]
	if dex == nil || dex.Sign() <= 0 {
		t.Fatal("the DEX fee bucket must hold the swap fee")
	}
	if i.Fees().Total().Cmp(dex) != 0 {
		t.Fatal("the total must equal the single recorded bucket")
	}
}

func TestSwapRejectsUnknownPoolAndChain(t *testing.T) {
	i := fixture(t)
	if _, err := i.CreatePool("TGR", "USDT", "tigersmartchain", 30); err != nil {
		t.Fatalf("CreatePool: %v", err)
	}
	if err := i.AddLiquidity("TGR", "USDT", big.NewInt(1000), big.NewInt(1000)); err != nil {
		t.Fatalf("AddLiquidity: %v", err)
	}
	if _, err := i.Swap("TGR", "NOPE", "tigersmartchain", big.NewInt(10)); !IsCode(err, CodeNotFound) {
		t.Fatalf("expected NOT_FOUND for an unknown pool, got %v", err)
	}
	if _, err := i.Swap("TGR", "USDT", "ethereum", big.NewInt(10)); !IsCode(err, CodeNotFound) {
		t.Fatalf("expected NOT_FOUND for a pool on another chain, got %v", err)
	}
	if _, err := i.Swap("TGR", "USDT", "tigersmartchain", big.NewInt(0)); !IsCode(err, CodeValidation) {
		t.Fatalf("expected VALIDATION_FAILED for a zero amount, got %v", err)
	}
}

func TestCreatePoolRejectsUnknownToken(t *testing.T) {
	i := fixture(t)
	if _, err := i.CreatePool("TGR", "GHOST", "tigersmartchain", 30); !IsCode(err, CodeNotFound) {
		t.Fatalf("expected NOT_FOUND for an unlisted token, got %v", err)
	}
	if _, err := i.CreatePool("TGR", "TGR", "tigersmartchain", 30); !IsCode(err, CodeValidation) {
		t.Fatalf("expected VALIDATION_FAILED for a self-pair, got %v", err)
	}
}

func TestBridgeFeeIsExact(t *testing.T) {
	i := fixture(t)
	bridge := BridgeConfig{
		Key:             "tsc_eth",
		SourceChain:     "tigersmartchain",
		TargetChain:     "ethereum",
		ContractAddress: "0x3333333333333333333333333333333333333333",
		MinAmount:       big.NewInt(100),
		MaxAmount:       big.NewInt(1_000_000),
		FeeBps:          10, // 0.10%
	}
	if err := i.AddBridge(bridge); err != nil {
		t.Fatalf("AddBridge: %v", err)
	}

	amount := big.NewInt(10_000)
	fee, net, err := i.BridgeFee("tsc_eth", amount)
	if err != nil {
		t.Fatalf("BridgeFee: %v", err)
	}
	if fee.Cmp(big.NewInt(10)) != 0 {
		t.Fatalf("fee %s != 10", fee)
	}
	// The parts sum exactly back to the input.
	if new(big.Int).Add(fee, net).Cmp(amount) != 0 {
		t.Fatal("fee + net must equal the amount")
	}
	// The fee is booked against the target chain.
	recorded := i.Fees().ByChain("ethereum")[FeeTypeBridge]
	if recorded == nil || recorded.Cmp(fee) != 0 {
		t.Fatal("bridge fee must be booked to the target chain")
	}
}

func TestBridgeValidatesRangeAndChains(t *testing.T) {
	i := fixture(t)
	bad := BridgeConfig{
		Key: "b", SourceChain: "tigersmartchain", TargetChain: "nowhere",
		ContractAddress: "0x1", MinAmount: big.NewInt(1), MaxAmount: big.NewInt(10),
	}
	if err := i.AddBridge(bad); !IsCode(err, CodeNotFound) {
		t.Fatalf("expected NOT_FOUND for an unregistered chain, got %v", err)
	}
	ok := BridgeConfig{
		Key: "b2", SourceChain: "tigersmartchain", TargetChain: "ethereum",
		ContractAddress: "0x1", MinAmount: big.NewInt(100), MaxAmount: big.NewInt(1000), FeeBps: 10,
	}
	if err := i.AddBridge(ok); err != nil {
		t.Fatalf("AddBridge: %v", err)
	}
	// Below the minimum and above the maximum are both refused.
	if _, _, err := i.BridgeFee("b2", big.NewInt(50)); !IsCode(err, CodeAmountOutOfRange) {
		t.Fatalf("expected AMOUNT_OUT_OF_RANGE below the minimum, got %v", err)
	}
	if _, _, err := i.BridgeFee("b2", big.NewInt(2000)); !IsCode(err, CodeAmountOutOfRange) {
		t.Fatalf("expected AMOUNT_OUT_OF_RANGE above the maximum, got %v", err)
	}
	if _, _, err := i.BridgeFee("missing", big.NewInt(500)); !IsCode(err, CodeNotFound) {
		t.Fatalf("expected NOT_FOUND for an unknown bridge, got %v", err)
	}
}

func TestFeeLedgerIgnoresNonPositive(t *testing.T) {
	ledger := NewFeeLedger()
	ledger.Record(FeeTypeDEX, big.NewInt(100), "tigersmartchain")
	ledger.Record(FeeTypeBridge, big.NewInt(50), "ethereum")
	ledger.Record(FeeTypeDEX, big.NewInt(0), "tigersmartchain")
	ledger.Record(FeeTypeDEX, big.NewInt(-5), "tigersmartchain")
	ledger.Record(FeeTypeWallet, nil, "ethereum")

	if got := ledger.Total().String(); got != "150" {
		t.Fatalf("total %s != 150", got)
	}
	byType := ledger.TotalByType()
	if byType[FeeTypeDEX].String() != "100" {
		t.Fatal("DEX bucket must be 100")
	}
	if byType[FeeTypeBridge].String() != "50" {
		t.Fatal("bridge bucket must be 50")
	}
	if _, ok := byType[FeeTypeWallet]; ok {
		t.Fatal("a nil amount must not create a bucket")
	}
}

func TestPriceImpactIsPositiveForASale(t *testing.T) {
	i := fixture(t)
	if _, err := i.CreatePool("TGR", "USDT", "tigersmartchain", 30); err != nil {
		t.Fatalf("CreatePool: %v", err)
	}
	if err := i.AddLiquidity("TGR", "USDT", big.NewInt(1_000_000), big.NewInt(500_000)); err != nil {
		t.Fatalf("AddLiquidity: %v", err)
	}
	impact, err := i.Pool("TGR", "USDT").PriceImpactBps("TGR", big.NewInt(10_000))
	if err != nil {
		t.Fatalf("PriceImpactBps: %v", err)
	}
	if impact <= 0 {
		t.Fatalf("selling into a pool must move the price, got impact %d", impact)
	}
}

func TestHandleAPIServesRegistryAndFees(t *testing.T) {
	i := fixture(t)

	rec := httptest.NewRecorder()
	i.HandleAPI(rec, httptest.NewRequest(http.MethodGet, "/api/chains", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("chains status %d", rec.Code)
	}
	var chains APIResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &chains); err != nil {
		t.Fatalf("decode chains: %v", err)
	}
	if !chains.Success {
		t.Fatal("chains response must be successful")
	}
	if rec.Header().Get("Cache-Control") == "" {
		t.Fatal("responses must not be cached")
	}

	rec = httptest.NewRecorder()
	i.HandleAPI(rec, httptest.NewRequest(http.MethodGet, "/api/nope", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown path status %d", rec.Code)
	}

	rec = httptest.NewRecorder()
	i.HandleAPI(rec, httptest.NewRequest(http.MethodPost, "/api/chains", nil))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST status %d", rec.Code)
	}
}
