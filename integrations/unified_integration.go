/**
 * TigerEx Unified Integration Layer
 *
 * Registry and accounting for the products the exchange operates together:
 * TigerWallet, Tigerswap, TigerSmartChain (TGR + RUSD) and fee collection.
 *
 * The layer holds operator configuration and does the arithmetic that is shared
 * between products. It never invents data: a chain without a node URL, a
 * non-native token without a contract address, a pool without reserves, or a
 * swap against an unknown token all fail closed with a typed error. Address
 * derivation, signing and chain reads belong to the wallet service, which owns
 * the key material; this package takes addresses and amounts from its caller.
 *
 * Copyright (c) 2024 TigerEx
 * Licensed under MIT License
 */

package integrations

import (
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"
)

// ==================== Errors ====================

// Error codes returned by the layer. They are stable strings so a caller can
// branch on a code rather than on a message.
const (
	CodeValidation       = "VALIDATION_FAILED"
	CodeNotFound         = "NOT_FOUND"
	CodeInsufficient     = "INSUFFICIENT_LIQUIDITY"
	CodeNotConfigured    = "NOT_CONFIGURED"
	CodeAmountOutOfRange = "AMOUNT_OUT_OF_RANGE"
)

// IntegrationError is the typed error every failure returns.
type IntegrationError struct {
	Code    string
	Message string
}

func (e *IntegrationError) Error() string { return e.Code + ": " + e.Message }

func newError(code, message string) error { return &IntegrationError{Code: code, Message: message} }

// IsCode reports whether err carries the given code.
func IsCode(err error, code string) bool {
	var target *IntegrationError
	return errors.As(err, &target) && target.Code == code
}

// ==================== Chain Types ====================

// ChainType is the family a chain belongs to.
type ChainType string

const (
	ChainTypeEVM    ChainType = "evm"
	ChainTypeSolana ChainType = "solana"
	ChainTypeNear   ChainType = "near"
	ChainTypeAptos  ChainType = "aptos"
	ChainTypeSui    ChainType = "sui"
)

// ChainConfig is one chain the exchange serves. RPCURL is the node the balance
// reader dials; a chain cannot be registered without it.
type ChainConfig struct {
	Key      string    `json:"key"`
	Name     string    `json:"name"`
	Type     ChainType `json:"type"`
	Symbol   string    `json:"symbol"`
	Decimals uint8     `json:"decimals"`
	RPCURL   string    `json:"rpc_url"`
	ChainID  string    `json:"chain_id"`
	IsActive bool      `json:"is_active"`
	IsNative bool      `json:"is_native"`
	Explorer string    `json:"explorer_url,omitempty"`
}

// Validate checks the configuration is usable. A blank key, an unknown type, a
// blank symbol or a node URL that is not an absolute http(s) URL is refused, so
// the registry cannot hold a chain that would be dialled at an endpoint an
// operator never configured.
func (c ChainConfig) Validate() error {
	if strings.TrimSpace(c.Key) == "" {
		return newError(CodeValidation, "chain key is required")
	}
	if strings.TrimSpace(c.Name) == "" {
		return newError(CodeValidation, "chain name is required")
	}
	switch c.Type {
	case ChainTypeEVM, ChainTypeSolana, ChainTypeNear, ChainTypeAptos, ChainTypeSui:
	default:
		return newError(CodeValidation, fmt.Sprintf("unsupported chain type %q", c.Type))
	}
	if strings.TrimSpace(c.Symbol) == "" {
		return newError(CodeValidation, "chain native symbol is required")
	}
	if c.Decimals > 36 {
		return newError(CodeValidation, "chain decimals must be 36 or fewer")
	}
	if err := validateEndpoint(c.RPCURL, false); err != nil {
		return err
	}
	if c.Explorer != "" {
		if err := validateEndpoint(c.Explorer, false); err != nil {
			return err
		}
	}
	return nil
}

// validateEndpoint accepts an absolute http(s) URL without embedded
// credentials. `allowEmpty` is false for a node URL, which is mandatory.
func validateEndpoint(raw string, allowEmpty bool) error {
	if strings.TrimSpace(raw) == "" {
		if allowEmpty {
			return nil
		}
		return newError(CodeNotConfigured, "node URL is required")
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return newError(CodeValidation, "endpoint is not a valid URL")
	}
	if parsed.User != nil {
		return newError(CodeValidation, "endpoint must not carry credentials")
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return newError(CodeValidation, "endpoint must be http or https")
	}
	if parsed.Host == "" {
		return newError(CodeValidation, "endpoint must have a host")
	}
	return nil
}

// TokenConfig is one token listed on a chain. A non-native token needs its
// contract address, or a balance read would return zero.
type TokenConfig struct {
	Symbol       string   `json:"symbol"`
	Name         string   `json:"name"`
	Address      string   `json:"address"`
	ChainKey     string   `json:"chain_key"`
	Decimals     uint8    `json:"decimals"`
	IsNative     bool     `json:"is_native"`
	IsStablecoin bool     `json:"is_stablecoin"`
	TotalSupply  *big.Int `json:"total_supply,omitempty"`
}

// Validate checks the token is listed on a real chain with the fields a balance
// read needs.
func (t TokenConfig) Validate(chain *ChainConfig) error {
	if chain == nil {
		return newError(CodeNotFound, fmt.Sprintf("chain %q is not registered", t.ChainKey))
	}
	if strings.TrimSpace(t.Symbol) == "" {
		return newError(CodeValidation, "token symbol is required")
	}
	if strings.TrimSpace(t.Name) == "" {
		return newError(CodeValidation, "token name is required")
	}
	if t.Decimals > 36 {
		return newError(CodeValidation, "token decimals must be 36 or fewer")
	}
	if !t.IsNative && strings.TrimSpace(t.Address) == "" {
		return newError(CodeValidation, fmt.Sprintf("a contract address is required for %s on %s", t.Symbol, t.ChainKey))
	}
	if t.TotalSupply != nil && t.TotalSupply.Sign() < 0 {
		return newError(CodeValidation, "total supply cannot be negative")
	}
	return nil
}

// ==================== Bridge Types ====================

// BridgeConfig is a cross-chain bridge the exchange operates. FeeBps is the fee
// in basis points (1 bps = 0.01%).
type BridgeConfig struct {
	Key             string   `json:"key"`
	SourceChain     string   `json:"source_chain"`
	TargetChain     string   `json:"target_chain"`
	ContractAddress string   `json:"contract_address"`
	MinAmount       *big.Int `json:"min_amount"`
	MaxAmount       *big.Int `json:"max_amount"`
	FeeBps          int64    `json:"fee_bps"`
}

// Validate checks the bridge names two registered chains, a contract, and a
// coherent amount range and fee.
func (b BridgeConfig) Validate(chains map[string]*ChainConfig) error {
	if strings.TrimSpace(b.Key) == "" {
		return newError(CodeValidation, "bridge key is required")
	}
	if b.SourceChain == b.TargetChain {
		return newError(CodeValidation, "bridge source and target chains must differ")
	}
	if _, ok := chains[b.SourceChain]; !ok {
		return newError(CodeNotFound, fmt.Sprintf("source chain %q is not registered", b.SourceChain))
	}
	if _, ok := chains[b.TargetChain]; !ok {
		return newError(CodeNotFound, fmt.Sprintf("target chain %q is not registered", b.TargetChain))
	}
	if strings.TrimSpace(b.ContractAddress) == "" {
		return newError(CodeValidation, "bridge contract address is required")
	}
	if b.MinAmount == nil || b.MinAmount.Sign() <= 0 {
		return newError(CodeValidation, "bridge minimum amount must be positive")
	}
	if b.MaxAmount == nil || b.MaxAmount.Cmp(b.MinAmount) < 0 {
		return newError(CodeValidation, "bridge maximum amount must be at least the minimum")
	}
	if b.FeeBps < 0 || b.FeeBps >= 10000 {
		return newError(CodeValidation, "bridge fee must be a fraction in [0, 10000) basis points")
	}
	return nil
}

// Fee applies the bridge's basis-point fee to an amount, returning the fee and
// the amount after it. The parts always sum back to the input.
func (b BridgeConfig) Fee(amount *big.Int) (*big.Int, *big.Int) {
	fee := new(big.Int).Mul(amount, big.NewInt(b.FeeBps))
	fee.Div(fee, big.NewInt(10000))
	net := new(big.Int).Sub(amount, fee)
	return fee, net
}

// ==================== Fee Collection ====================

// FeeType names the source a fee was collected from.
type FeeType string

const (
	FeeTypeExchange FeeType = "exchange"
	FeeTypeDEX      FeeType = "dex"
	FeeTypeBridge   FeeType = "bridge"
	FeeTypeWallet   FeeType = "wallet"
	FeeTypeStaking  FeeType = "staking"
)

// FeeLedger records fees against their source. Only fees actually recorded are
// reported; nothing is apportioned from a total.
type FeeLedger struct {
	mu      sync.RWMutex
	byType  map[FeeType]*big.Int
	byChain map[string]map[FeeType]*big.Int
	daily   map[string]map[FeeType]*big.Int
}

// NewFeeLedger returns an empty ledger.
func NewFeeLedger() *FeeLedger {
	return &FeeLedger{
		byType:  make(map[FeeType]*big.Int),
		byChain: make(map[string]map[FeeType]*big.Int),
		daily:   make(map[string]map[FeeType]*big.Int),
	}
}

// Record adds a fee in base units to the source and chain buckets. A nil or
// non-positive amount is ignored rather than booked.
func (l *FeeLedger) Record(feeType FeeType, amount *big.Int, chainKey string) {
	if amount == nil || amount.Sign() <= 0 {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()

	if l.byType[feeType] == nil {
		l.byType[feeType] = new(big.Int)
	}
	l.byType[feeType].Add(l.byType[feeType], amount)

	if l.byChain[chainKey] == nil {
		l.byChain[chainKey] = make(map[FeeType]*big.Int)
	}
	if l.byChain[chainKey][feeType] == nil {
		l.byChain[chainKey][feeType] = new(big.Int)
	}
	l.byChain[chainKey][feeType].Add(l.byChain[chainKey][feeType], amount)

	day := time.Now().UTC().Format("2006-01-02")
	if l.daily[day] == nil {
		l.daily[day] = make(map[FeeType]*big.Int)
	}
	if l.daily[day][feeType] == nil {
		l.daily[day][feeType] = new(big.Int)
	}
	l.daily[day][feeType].Add(l.daily[day][feeType], amount)
}

// TotalByType returns a copy of the per-source totals.
func (l *FeeLedger) TotalByType() map[FeeType]*big.Int {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return copyTypeMap(l.byType)
}

// Total sums every fee recorded, which is the sum of the per-source buckets.
func (l *FeeLedger) Total() *big.Int {
	l.mu.RLock()
	defer l.mu.RUnlock()
	total := new(big.Int)
	for _, v := range l.byType {
		total.Add(total, v)
	}
	return total
}

// ByChain returns the fees recorded against one chain.
func (l *FeeLedger) ByChain(chainKey string) map[FeeType]*big.Int {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return copyTypeMap(l.byChain[chainKey])
}

// Daily returns a copy of the per-day, per-source totals.
func (l *FeeLedger) Daily() map[string]map[FeeType]*big.Int {
	l.mu.RLock()
	defer l.mu.RUnlock()
	out := make(map[string]map[FeeType]*big.Int, len(l.daily))
	for day, fees := range l.daily {
		out[day] = copyTypeMap(fees)
	}
	return out
}

func copyTypeMap(in map[FeeType]*big.Int) map[FeeType]*big.Int {
	out := make(map[FeeType]*big.Int, len(in))
	for k, v := range in {
		out[k] = new(big.Int).Set(v)
	}
	return out
}

// ==================== Liquidity Pools ====================

// Pool is a constant-product (x*y=k) liquidity pool. Reserves are in base units
// of each token. A pool created with no reserves cannot quote or trade.
type Pool struct {
	ID       string   `json:"id"`
	TokenA   string   `json:"token_a"`
	TokenB   string   `json:"token_b"`
	ChainKey string   `json:"chain_key"`
	ReserveA *big.Int `json:"reserve_a"`
	ReserveB *big.Int `json:"reserve_b"`
	FeeBps   int64    `json:"fee_bps"`
}

// poolKey returns the canonical pool key, ordering the two symbols so a pool is
// found whichever way a caller names the pair.
func poolKey(a, b string) string {
	if a <= b {
		return a + "/" + b
	}
	return b + "/" + a
}

// Quote returns the output for selling `amountIn` of `tokenIn` into the pool,
// using the constant-product formula with the fee taken off the input. It fails
// closed on an unknown token, a non-positive amount, or an empty pool.
func (p *Pool) Quote(tokenIn string, amountIn *big.Int) (*big.Int, error) {
	if amountIn == nil || amountIn.Sign() <= 0 {
		return nil, newError(CodeValidation, "swap amount must be positive")
	}
	var reserveIn, reserveOut *big.Int
	switch tokenIn {
	case p.TokenA:
		reserveIn, reserveOut = p.ReserveA, p.ReserveB
	case p.TokenB:
		reserveIn, reserveOut = p.ReserveB, p.ReserveA
	default:
		return nil, newError(CodeNotFound, fmt.Sprintf("%s is not in pool %s", tokenIn, p.ID))
	}
	if reserveIn == nil || reserveOut == nil || reserveIn.Sign() <= 0 || reserveOut.Sign() <= 0 {
		return nil, newError(CodeInsufficient, fmt.Sprintf("pool %s has no liquidity", p.ID))
	}
	if p.FeeBps < 0 || p.FeeBps >= 10000 {
		return nil, newError(CodeValidation, "pool fee must be a fraction in [0, 10000) basis points")
	}

	fee := new(big.Int).Mul(amountIn, big.NewInt(p.FeeBps))
	fee.Div(fee, big.NewInt(10000))
	amountInAfterFee := new(big.Int).Sub(amountIn, fee)
	if amountInAfterFee.Sign() <= 0 {
		return nil, newError(CodeValidation, "swap amount is smaller than the pool fee")
	}

	// out = (in * reserveOut) / (reserveIn + in)
	numerator := new(big.Int).Mul(amountInAfterFee, reserveOut)
	denominator := new(big.Int).Add(reserveIn, amountInAfterFee)
	out := numerator.Div(numerator, denominator)
	if out.Sign() <= 0 {
		return nil, newError(CodeInsufficient, "swap output would be zero")
	}
	return out, nil
}

// PriceImpactBps reports how far the execution price moved from the pool mid
// price, in basis points. Selling into a pool always moves the price against
// the trader, so the value is positive for a non-zero trade.
func (p *Pool) PriceImpactBps(tokenIn string, amountIn *big.Int) (int64, error) {
	out, err := p.Quote(tokenIn, amountIn)
	if err != nil {
		return 0, err
	}
	var reserveIn, reserveOut *big.Int
	if tokenIn == p.TokenA {
		reserveIn, reserveOut = p.ReserveA, p.ReserveB
	} else {
		reserveIn, reserveOut = p.ReserveB, p.ReserveA
	}
	// spot = reserveOut/reserveIn; execution = out/amountIn. Both are ratios of
	// big.Ints, so cross-multiply to compare without floating point:
	// impact = 1 - (out*reserveIn)/(amountIn*reserveOut)
	numerator := new(big.Int).Mul(out, reserveIn)
	denominator := new(big.Int).Mul(amountIn, reserveOut)
	if denominator.Sign() == 0 {
		return 0, newError(CodeInsufficient, "pool has no liquidity")
	}
	diff := new(big.Int).Sub(denominator, numerator)
	if diff.Sign() <= 0 {
		return 0, nil
	}
	scaled := new(big.Int).Mul(diff, big.NewInt(10000))
	scaled.Div(scaled, denominator)
	return scaled.Int64(), nil
}

// ==================== Integration Layer ====================

// Integration holds the registries and the fee ledger. It is safe for
// concurrent use.
type Integration struct {
	mu      sync.RWMutex
	chains  map[string]*ChainConfig
	tokens  map[string]map[string]*TokenConfig // chainKey -> symbol -> token
	bridges map[string]*BridgeConfig
	pools   map[string]*Pool // canonical pool key -> pool
	fees    *FeeLedger
}

// New returns an empty integration layer. Nothing is seeded.
func New() *Integration {
	return &Integration{
		chains:  make(map[string]*ChainConfig),
		tokens:  make(map[string]map[string]*TokenConfig),
		bridges: make(map[string]*BridgeConfig),
		pools:   make(map[string]*Pool),
		fees:    NewFeeLedger(),
	}
}

// Fees returns the fee ledger.
func (i *Integration) Fees() *FeeLedger { return i.fees }

// AddChain registers a chain. Re-registering the same key replaces the row.
func (i *Integration) AddChain(config ChainConfig) error {
	if err := config.Validate(); err != nil {
		return err
	}
	i.mu.Lock()
	defer i.mu.Unlock()
	stored := config
	i.chains[config.Key] = &stored
	return nil
}

// Chain returns a registered chain, or nil.
func (i *Integration) Chain(key string) *ChainConfig {
	i.mu.RLock()
	defer i.mu.RUnlock()
	return i.chains[key]
}

// Chains returns every registered chain, ordered by key.
func (i *Integration) Chains() []ChainConfig {
	i.mu.RLock()
	defer i.mu.RUnlock()
	out := make([]ChainConfig, 0, len(i.chains))
	for _, c := range i.chains {
		out = append(out, *c)
	}
	sort.Slice(out, func(a, b int) bool { return out[a].Key < out[b].Key })
	return out
}

// AddToken lists a token on a registered chain.
func (i *Integration) AddToken(token TokenConfig) error {
	i.mu.Lock()
	defer i.mu.Unlock()
	chain := i.chains[token.ChainKey]
	if err := token.Validate(chain); err != nil {
		return err
	}
	if i.tokens[token.ChainKey] == nil {
		i.tokens[token.ChainKey] = make(map[string]*TokenConfig)
	}
	stored := token
	i.tokens[token.ChainKey][token.Symbol] = &stored
	return nil
}

// Token returns a token listed on a chain, or nil.
func (i *Integration) Token(chainKey, symbol string) *TokenConfig {
	i.mu.RLock()
	defer i.mu.RUnlock()
	if byChain, ok := i.tokens[chainKey]; ok {
		return byChain[symbol]
	}
	return nil
}

// TokensOnChain returns the tokens listed on a chain, ordered by symbol.
func (i *Integration) TokensOnChain(chainKey string) []TokenConfig {
	i.mu.RLock()
	defer i.mu.RUnlock()
	byChain := i.tokens[chainKey]
	out := make([]TokenConfig, 0, len(byChain))
	for _, t := range byChain {
		out = append(out, *t)
	}
	sort.Slice(out, func(a, b int) bool { return out[a].Symbol < out[b].Symbol })
	return out
}

// AddBridge registers a bridge between two registered chains.
func (i *Integration) AddBridge(config BridgeConfig) error {
	i.mu.Lock()
	defer i.mu.Unlock()
	if err := config.Validate(i.chains); err != nil {
		return err
	}
	stored := config
	i.bridges[config.Key] = &stored
	return nil
}

// Bridge returns a registered bridge, or nil.
func (i *Integration) Bridge(key string) *BridgeConfig {
	i.mu.RLock()
	defer i.mu.RUnlock()
	return i.bridges[key]
}

// BridgeFee computes the fee for moving `amount` across a registered bridge.
// The bridge must exist and the amount must be inside its range.
func (i *Integration) BridgeFee(bridgeKey string, amount *big.Int) (fee, net *big.Int, err error) {
	bridge := i.Bridge(bridgeKey)
	if bridge == nil {
		return nil, nil, newError(CodeNotFound, fmt.Sprintf("bridge %q is not registered", bridgeKey))
	}
	if amount == nil || amount.Sign() <= 0 {
		return nil, nil, newError(CodeValidation, "bridge amount must be positive")
	}
	if amount.Cmp(bridge.MinAmount) < 0 || amount.Cmp(bridge.MaxAmount) > 0 {
		return nil, nil, newError(CodeAmountOutOfRange,
			fmt.Sprintf("amount must be between %s and %s", bridge.MinAmount, bridge.MaxAmount))
	}
	fee, net = bridge.Fee(amount)
	i.fees.Record(FeeTypeBridge, fee, bridge.TargetChain)
	return fee, net, nil
}

// CreatePool registers a pool between two tokens listed on the same chain.
func (i *Integration) CreatePool(tokenA, tokenB, chainKey string, feeBps int64) (*Pool, error) {
	if tokenA == tokenB {
		return nil, newError(CodeValidation, "a pool needs two distinct tokens")
	}
	if feeBps < 0 || feeBps >= 10000 {
		return nil, newError(CodeValidation, "pool fee must be a fraction in [0, 10000) basis points")
	}
	i.mu.Lock()
	defer i.mu.Unlock()
	if tokenOnChain(i.tokens, chainKey, tokenA) == nil {
		return nil, newError(CodeNotFound, fmt.Sprintf("token %s is not listed on %s", tokenA, chainKey))
	}
	if tokenOnChain(i.tokens, chainKey, tokenB) == nil {
		return nil, newError(CodeNotFound, fmt.Sprintf("token %s is not listed on %s", tokenB, chainKey))
	}
	pool := &Pool{
		ID:       poolKey(tokenA, tokenB),
		TokenA:   tokenA,
		TokenB:   tokenB,
		ChainKey: chainKey,
		ReserveA: new(big.Int),
		ReserveB: new(big.Int),
		FeeBps:   feeBps,
	}
	i.pools[pool.ID] = pool
	return pool, nil
}

// tokenOnChain is the lock-free lookup used while the write lock is held.
func tokenOnChain(tokens map[string]map[string]*TokenConfig, chainKey, symbol string) *TokenConfig {
	if byChain, ok := tokens[chainKey]; ok {
		return byChain[symbol]
	}
	return nil
}

// Pool returns a registered pool, or nil.
func (i *Integration) Pool(tokenA, tokenB string) *Pool {
	i.mu.RLock()
	defer i.mu.RUnlock()
	return i.pools[poolKey(tokenA, tokenB)]
}

// Pools returns every registered pool, ordered by id.
func (i *Integration) Pools() []Pool {
	i.mu.RLock()
	defer i.mu.RUnlock()
	out := make([]Pool, 0, len(i.pools))
	for _, p := range i.pools {
		out = append(out, *p)
	}
	sort.Slice(out, func(a, b int) bool { return out[a].ID < out[b].ID })
	return out
}

// AddLiquidity adds reserves to a pool. Both amounts must be positive.
func (i *Integration) AddLiquidity(tokenA, tokenB string, amountA, amountB *big.Int) error {
	if amountA == nil || amountA.Sign() <= 0 || amountB == nil || amountB.Sign() <= 0 {
		return newError(CodeValidation, "liquidity amounts must be positive")
	}
	i.mu.Lock()
	defer i.mu.Unlock()
	pool := i.pools[poolKey(tokenA, tokenB)]
	if pool == nil {
		return newError(CodeNotFound, fmt.Sprintf("pool %s/%s is not registered", tokenA, tokenB))
	}
	// Keep the stored sides aligned with the pool's canonical ordering.
	if pool.TokenA == tokenA {
		pool.ReserveA.Add(pool.ReserveA, amountA)
		pool.ReserveB.Add(pool.ReserveB, amountB)
	} else {
		pool.ReserveA.Add(pool.ReserveA, amountB)
		pool.ReserveB.Add(pool.ReserveB, amountA)
	}
	return nil
}

// Swap quotes and settles a swap against a pool: it returns the output and
// advances the reserves so the next swap sees the post-trade state. The DEX fee
// is booked to the ledger. The pool must be on the named chain.
func (i *Integration) Swap(tokenIn, tokenOut, chainKey string, amountIn *big.Int) (*big.Int, error) {
	i.mu.Lock()
	defer i.mu.Unlock()

	pool := i.pools[poolKey(tokenIn, tokenOut)]
	if pool == nil {
		return nil, newError(CodeNotFound, fmt.Sprintf("pool %s/%s is not registered", tokenIn, tokenOut))
	}
	if pool.ChainKey != chainKey {
		return nil, newError(CodeNotFound, fmt.Sprintf("pool %s is not on %s", pool.ID, chainKey))
	}
	out, err := pool.Quote(tokenIn, amountIn)
	if err != nil {
		return nil, err
	}

	fee := new(big.Int).Mul(amountIn, big.NewInt(pool.FeeBps))
	fee.Div(fee, big.NewInt(10000))
	amountInAfterFee := new(big.Int).Sub(amountIn, fee)

	if pool.TokenA == tokenIn {
		pool.ReserveA.Add(pool.ReserveA, amountInAfterFee)
		pool.ReserveB.Sub(pool.ReserveB, out)
	} else {
		pool.ReserveB.Add(pool.ReserveB, amountInAfterFee)
		pool.ReserveA.Sub(pool.ReserveA, out)
	}
	i.fees.Record(FeeTypeDEX, fee, chainKey)
	return out, nil
}

// ==================== HTTP Handler ====================

// APIResponse is the shape every handler returns.
type APIResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

// HandleAPI serves read-only registry and fee views. It never mutates state and
// never returns a balance: balances come from the chain, through the wallet
// service.
func (i *Integration) HandleAPI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")

	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		_ = json.NewEncoder(w).Encode(APIResponse{Success: false, Error: "method not allowed"})
		return
	}

	var resp APIResponse
	switch r.URL.Path {
	case "/api/chains":
		resp = APIResponse{Success: true, Data: i.Chains()}
	case "/api/pools":
		resp = APIResponse{Success: true, Data: i.Pools()}
	case "/api/fees":
		fees := i.fees.TotalByType()
		flat := make(map[string]string, len(fees))
		for k, v := range fees {
			flat[string(k)] = v.String()
		}
		resp = APIResponse{Success: true, Data: map[string]interface{}{
			"by_type": flat,
			"total":   i.fees.Total().String(),
		}}
	default:
		w.WriteHeader(http.StatusNotFound)
		resp = APIResponse{Success: false, Error: "not found"}
	}
	_ = json.NewEncoder(w).Encode(resp)
}
