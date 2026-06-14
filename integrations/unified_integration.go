/**
 * TigerEx Unified Integration Layer
 * 
 * Integrates:
 * - TigerWallet (Multichain Web3 Wallet)
 * - Tigerswap (Multichain DEX)
 * - TigerSmartChain (EVM Blockchain with TGR & RUSD)
 * - Fee Collection System
 * 
 * Copyright (c) 2024 TigerEx
 * Licensed under MIT License
 */

package main

import (
	"encoding/json"
	"fmt"
	"math/big"
	"sync"
	"time"
)

// ==================== Chain Types ====================

// ChainType represents the type of blockchain
type ChainType string

const (
	ChainTypeEVM    ChainType = "evm"
	ChainTypeSolana ChainType = "solana"
	ChainTypeNear  ChainType = "near"
	ChainTypeAptos ChainType = "aptos"
	ChainTypeSui   ChainType = "sui"
)

// ChainConfig represents blockchain configuration
type ChainConfig struct {
	ID             uint32            `json:"id"`
	Key            string           `json:"key"`
	Name           string           `json:"name"`
	Type           ChainType        `json:"type"`
	Symbol         string           `json:"symbol"`
	Decimals       uint8            `json:"decimals"`
	RPCURL         string           `json:"rpc_url"`
	ExplorerURL   string           `json:"explorer_url"`
	ChainID        string           `json:"chain_id"`
	IsActive       bool            `json:"is_active"`
	IsNative       bool            `json:"is_native"`
	BridgeAddress  string           `json:"bridge_address"`
	TokenListURL   string           `json:"token_list_url"`
}

// TokenConfig represents token configuration
type TokenConfig struct {
	Address        string           `json:"address"`
	Symbol        string           `json:"symbol"`
	Name          string           `json:"name"`
	Decimals      uint8            `json:"decimals"`
	ChainKey      string           `json:"chain_key"`
	IsNative     bool             `json:"is_native"`
	TotalSupply  *big.Int        `json:"total_supply"`
	PriceUSD     float64          `json:"price_usd"`
	IsStablecoin bool             `json:"is_stablecoin"`
	IsVerified   bool             `json:"is_verified"`
	LogoURL      string           `json:"logo_url"`
}

// ==================== Product Integration ====================

// TigerWalletIntegration handles TigerWallet integration
type TigerWalletIntegration struct {
	mu           sync.RWMutex
	wallets      map[string]*Wallet
	providers   map[string]*ChainProvider
	transactions map[string]*Transaction
	
	// Session management
	sessions    map[string]*WalletSession
	sessionSeq  uint64
	
	// Fee configuration
	baseFee     float64 // Base fee for transactions
	gasFee     float64 // Gas fee multiplier
}

type Wallet struct {
	Address    string
	PublicKey  string
	ChainKey  string
	CreatedAt int64
	Encrypted bool
}

type ChainProvider struct {
	ChainKey   string
	RPCURL    string
	ChainID   uint32
	IsActive  bool
	LastUsed int64
}

type WalletSession struct {
	ID        string
	Wallet   string
	ChainKey string
	Type    string
	Created int64
	Expires int64
}

type Transaction struct {
	Hash       string
	From       string
	To         string
	Value      string
	GasLimit   uint64
	GasPrice   uint64
	Nonce      uint64
	ChainKey   string
	Status    string
	BlockNum  uint64
	Timestamp int64
}

// NewTigerWalletIntegration creates new TigerWallet integration
func NewTigerWalletIntegration() *TigerWalletIntegration {
	return &TigerWalletIntegration{
		wallets:      make(map[string]*Wallet),
		providers:   make(map[string]*ChainProvider),
		transactions: make(map[string]*Transaction),
		sessions:    make(map[string]*WalletSession),
		baseFee:     0.0001,    // 0.0001 TGR per transaction
		gasFee:      1.1,       // 10% gas fee markup
	}
}

// AddChain adds a supported chain
func (twi *TigerWalletIntegration) AddChain(config ChainConfig) error {
	twi.mu.Lock()
	defer twi.mu.Unlock()
	
	twi.providers[config.Key] = &ChainProvider{
		ChainKey:  config.Key,
		RPCURL:   config.RPCURL,
		ChainID:  config.ID,
		IsActive: config.IsActive,
		LastUsed: time.Now().Unix(),
	}
	
	return nil
}

// CreateWallet creates a new wallet
func (twi *TigerWalletIntegration) CreateWallet(chainKey string) (*Wallet, error) {
	twi.mu.Lock()
	defer twi.mu.Unlock()
	
	// Verify chain exists
	provider, ok := twi.providers[chainKey]
	if !ok {
		return nil, fmt.Errorf("chain not supported: %s", chainKey)
	}
	
	// Generate wallet address (in production, use proper key derivation)
	wallet := &Wallet{
		Address:    generateAddress(),
		PublicKey:  generatePublicKey(),
		ChainKey:  chainKey,
		CreatedAt: time.Now().Unix(),
		Encrypted: false,
	}
	
	twi.wallets[wallet.Address] = wallet
	provider.LastUsed = time.Now().Unix()
	
	return wallet, nil
}

// SignTransaction signs a transaction
func (twi *TigerWalletIntegration) SignTransaction(walletAddr, txHash string) (string, error) {
	twi.mu.RLock()
	defer twi.mu.RUnlock()
	
	wallet, ok := twi.wallets[walletAddr]
	if !ok {
		return "", fmt.Errorf("wallet not found: %s", walletAddr)
	}
	
	// Sign transaction (in production, use proper cryptographic signing)
	return signMessage(walletAddr + txHash), nil
}

// SendTransaction sends a transaction and collects fees
func (twi *TigerWalletIntegration) SendTransaction(tx *Transaction) (string, error) {
	twi.mu.Lock()
	defer twi.mu.Unlock()
	
	// Verify chain
	provider, ok := twi.providers[tx.ChainKey]
	if !ok {
		return "", fmt.Errorf("chain not supported: %s", tx.ChainKey)
	}
	
	if !provider.IsActive {
		return "", fmt.Errorf("chain not active: %s", tx.ChainKey)
	}
	
	// Calculate fee
	fee := twi.calculateTransactionFee(tx)
	
	// Execute transaction
	txHash := generateTxHash()
	tx.Hash = txHash
	tx.Status = "confirmed"
	tx.Timestamp = time.Now().Unix()
	
	twi.transactions[txHash] = tx
	provider.LastUsed = time.Now().Unix()
	
	// Record fee for collection
	FeeCollector.RecordFee(FeeTypeWallet, fee, tx.ChainKey)
	
	return txHash, nil
}

// calculateTransactionFee calculates the transaction fee
func (twi *TigerWalletIntegration) calculateTransactionFee(tx *Transaction) float64 {
	gasLimit := float64(tx.GasLimit)
	gasPrice := float64(tx.GasPrice)
	
	baseFee := twi.baseFee
	gasFee := (gasLimit * gasPrice) / 1e18 // Convert from wei
	
	return baseFee + (gasFee * twi.gasFee)
}

// GetBalance gets wallet balance
func (twi *TigerWalletIntegration) GetBalance(walletAddr, tokenAddr string) (*big.Int, error) {
	twi.mu.RLock()
	defer twi.mu.RUnlock()
	
	_, ok := twi.wallets[walletAddr]
	if !ok {
		return nil, fmt.Errorf("wallet not found: %s", walletAddr)
	}
	
	// Get balance from chain (mock for now)
	return big.NewInt(0), nil
}

// GetTransactionHistory gets transaction history
func (twi *TigerWalletIntegration) GetTransactionHistory(walletAddr string, limit int) ([]Transaction, error) {
	twi.mu.RLock()
	defer twi.mu.RUnlock()
	
	wallet, ok := twi.wallets[walletAddr]
	if !ok {
		return nil, fmt.Errorf("wallet not found: %s", walletAddr)
	}
	
	var txs []Transaction
	for _, tx := range twi.transactions {
		if tx.From == walletAddr || tx.To == walletAddr {
			txs = append(txs, *tx)
			if len(txs) >= limit {
				break
			}
		}
	}
	
	return txs, nil
}

// CreateSession creates a wallet session
func (twi *TigerWalletIntegration) CreateSession(walletAddr, sessionType string) (*WalletSession, error) {
	twi.mu.Lock()
	defer twi.mu.Unlock()
	
	wallet, ok := twi.wallets[walletAddr]
	if !ok {
		return nil, fmt.Errorf("wallet not found: %s", walletAddr)
	}
	
	twi.sessionSeq++
	session := &WalletSession{
		ID:        fmt.Sprintf("session_%d", twi.sessionSeq),
		Wallet:    walletAddr,
		ChainKey:  wallet.ChainKey,
		Type:     sessionType,
		Created:  time.Now().Unix(),
		Expires:  time.Now().Add(24 * time.Hour).Unix(),
	}
	
	twi.sessions[session.ID] = session
	return session, nil
}

// ==================== Tigerswap Integration ====================

// TigerswapIntegration handles Tigerswap DEX integration
type TigerswapIntegration struct {
	mu          sync.RWMutex
	pools       map[string]*LiquidityPool
	farms      map[string]*Farm
	routes     map[string][]string
	tokens     map[string]*TokenConfig
	
	// Fee configuration
	swapFee    float64 // 0.3% default
	ownerFee  float64 // Platform fee percentage
}

type LiquidityPool struct {
	ID          string
	TokenA      string
	TokenB     string
	ReserveA   *big.Int
	ReserveB   *big.Int
	Liquidity  *big.Int
	Fee        float64
	ChainKey   string
	Apr       float64
}

type Farm struct {
	PoolID     string
	RewardToken string
	RewardRate *big.Int
	Apr       float64
	StartTime  int64
	EndTime   int64
}

// NewTigerswapIntegration creates new Tigerswap integration
func NewTigerswapIntegration() *TigerswapIntegration {
	return &TigerswapIntegration{
		pools:     make(map[string]*LiquidityPool),
		farms:    make(map[string]*Farm),
		routes:   make(map[string][]string),
		tokens:   make(map[string]*TokenConfig),
		swapFee:   0.003,  // 0.3%
		ownerFee:  0.15,  // 15% of swap fee to platform
	}
}

// AddToken adds a supported token
func (tsi *TigerswapIntegration) AddToken(token TokenConfig) error {
	tsi.mu.Lock()
	defer tsi.mu.Unlock()
	
	key := fmt.Sprintf("%s_%s", token.ChainKey, token.Symbol)
	tsi.tokens[key] = &token
	return nil
}

// CreatePool creates a liquidity pool
func (tsi *TigerswapIntegration) CreatePool(tokenA, tokenB, chainKey string, fee float64) (*LiquidityPool, error) {
	tsi.mu.Lock()
	defer tsi.mu.Unlock()
	
	// Verify tokens exist
	aKey := fmt.Sprintf("%s_%s", chainKey, tokenA)
	bKey := fmt.Sprintf("%s_%s", chainKey, tokenB)
	
	if _, ok := tsi.tokens[aKey]; !ok {
		return nil, fmt.Errorf("token not found: %s", tokenA)
	}
	if _, ok := tsi.tokens[bKey]; !ok {
		return nil, fmt.Errorf("token not found: %s", tokenB)
	}
	
	pool := &LiquidityPool{
		ID:       fmt.Sprintf("%s_%s", tokenA, tokenB),
		TokenA:   tokenA,
		TokenB:  tokenB,
		ReserveA: big.NewInt(0),
		ReserveB: big.NewInt(0),
		Liquidity: big.NewInt(0),
		Fee:     fee,
		ChainKey: chainKey,
		Apr:     0,
	}
	
	tsi.pools[pool.ID] = pool
	return pool, nil
}

// AddLiquidity adds liquidity to pool
func (tsi *TigerswapIntegration) AddLiquidity(poolID string, amountA, amountB *big.Int) error {
	tsi.mu.Lock()
	defer tsi.mu.Unlock()
	
	pool, ok := tsi.pools[poolID]
	if !ok {
		return fmt.Errorf("pool not found: %s", poolID)
	}
	
	pool.ReserveA.Add(pool.ReserveA, amountA)
	pool.ReserveB.Add(pool.ReserveB, amountB)
	
	return nil
}

// Swap performs a swap and collects fees
func (tsi *TigerswapIntegration) Swap(tokenIn, tokenOut, chainKey string, amountIn *big.Int) (*big.Int, error) {
	tsi.mu.Lock()
	defer tsi.mu.Unlock()
	
	poolKey := fmt.Sprintf("%s_%s", tokenIn, tokenOut)
	pool, ok := tsi.pools[poolKey]
	if !ok {
		return nil, fmt.Errorf("pool not found: %s", poolKey)
	}
	
	// Calculate output amount (simplified AMM formula)
	amountOut := calculateSwapOutput(amountIn, pool.ReserveA, pool.ReserveB)
	
	// Calculate fees
	swapFeeAmount := new(big.Int).Mul(amountIn, big.NewInt(int64(tsi.swapFee*1000)))
	swapFeeAmount.Div(swapFeeAmount, big.NewInt(1000))
	
	ownerFeeAmount := new(big.Int).Mul(swapFeeAmount, big.NewInt(int64(tsi.ownerFee*100)))
	ownerFeeAmount.Div(ownerFeeAmount, big.NewInt(100))
	
	// Update reserves
	pool.ReserveA.Add(pool.ReserveA, amountIn)
	pool.ReserveB.Sub(pool.ReserveB, amountOut)
	
	// Record fees for collection
	FeeCollector.RecordFee(FeeTypeDEX, float64(swapFeeAmount.Int64()), chainKey)
	FeeCollector.RecordFee(FeeTypePlatform, float64(ownerFeeAmount.Int64()), chainKey)
	
	return amountOut, nil
}

// GetSwapQuote gets swap quote
func (tsi *TigerswapIntegration) GetSwapQuote(tokenIn, tokenOut, chainKey string, amountIn *big.Int) (*big.Int, float64, error) {
	tsi.mu.RLock()
	defer tsi.mu.RUnlock()
	
	poolKey := fmt.Sprintf("%s_%s", tokenIn, tokenOut)
	pool, ok := tsi.pools[poolKey]
	if !ok {
		return nil, 0, fmt.Errorf("pool not found: %s", poolKey)
	}
	
	amountOut := calculateSwapOutput(amountIn, pool.ReserveA, pool.ReserveB)
	priceImpact := calculatePriceImpact(amountIn, pool.ReserveA)
	
	return amountOut, priceImpact, nil
}

// CreateFarm creates a farm
func (tsi *TigerswapIntegration) CreateFarm(poolID, rewardToken string, rewardRate *big.Int, apy float64, durationDays int) (*Farm, error) {
	tsi.mu.Lock()
	defer tsi.mu.Unlock()
	
	_, ok := tsi.pools[poolID]
	if !ok {
		return nil, fmt.Errorf("pool not found: %s", poolID)
	}
	
	farm := &Farm{
		PoolID:     poolID,
		RewardToken: rewardToken,
		RewardRate: rewardRate,
		Apr:       apy,
		StartTime:  time.Now().Unix(),
		EndTime:   time.Now().Add(time.Duration(durationDays) * 24 * time.Hour).Unix(),
	}
	
	tsi.farms[poolID] = farm
	return farm, nil
}

// Stake stakes liquidity
func (tsi *TigerswapIntegration) Stake(poolID string, amount *big.Int) error {
	tsi.mu.Lock()
	defer tsi.mu.Unlock()
	
	farm, ok := tsi.farms[poolID]
	if !ok {
		return fmt.Errorf("farm not found: %s", poolID)
	}
	
	if time.Now().Unix() > farm.EndTime {
		return fmt.Errorf("farm ended")
	}
	
	// Stake logic here
	return nil
}

// ==================== TigerSmartChain Integration ====================

// TigerSmartChainIntegration handles TigerSmartChain integration
type TigerSmartChainIntegration struct {
	mu           sync.RWMutex
	nodes        map[string]*Node
	bridges      map[string]*Bridge
	tokens       map[string]*TokenConfig
	validators   map[string]*Validator
	
	// Native tokens
	tgrToken    *TokenConfig
	rusdToken  *TokenConfig
	
	// Chain config
	chainConfig ChainConfig
}

type Node struct {
	ID        string
	URL      string
	IsActive bool
	LastSync int64
	Stake    *big.Int
}

type Bridge struct {
	ID            string
	SourceChain   string
	TargetChain   string
	MinAmount    *big.Int
	MaxAmount    *big.Int
	Fee          float64
	FeePercent   float64
	TimeEstimate int64 // seconds
	IsActive     bool
}

type Validator struct {
	Address     string
	Stake       *big.Int
	Commission  float64
	Rewards    *big.Int
	IsActive    bool
	JoinedAt   int64
}

// NewTigerSmartChainIntegration creates new TigerSmartChain integration
func NewTigerSmartChainIntegration() *TigerSmartChainIntegration {
	tsci := &TigerSmartChainIntegration{
		nodes:      make(map[string]*Node),
		bridges:    make(map[string]*Bridge),
		tokens:    make(map[string]*TokenConfig),
		validators: make(map[string]*Validator),
		chainConfig: ChainConfig{
			ID:          2024,
			Key:         "tigersmartchain",
			Name:        "TigerSmartChain",
			Type:        ChainTypeEVM,
			Symbol:      "TGR",
			Decimals:    18,
			IsActive:    true,
			IsNative:    true,
		},
	}
	
	// Initialize native tokens
	tsci.tgrToken = &TokenConfig{
		Address:        "0x0000000000000000000000000000000000000000",
		Symbol:        "TGR",
		Name:          "Tiger Coin",
		Decimals:       18,
		ChainKey:       "tigersmartchain",
		IsNative:      true,
		TotalSupply:  new(big.Int).Exp(big.NewInt(1), big.NewInt(18), nil), // 1B TGR
		PriceUSD:     0.05,
		IsStablecoin: false,
		IsVerified:   true,
	}
	
	tsci.rusdToken = &TokenConfig{
		Address:        "0x7886Cc6E7C5E8c4B7d9338d4B2dA6aF7dC3f8F8C8",
		Symbol:        "RUSD",
		Name:          "Royal Tiger United States Dollar",
		Decimals:      18,
		ChainKey:       "tigersmartchain",
		IsNative:      false,
		TotalSupply:  new(big.Int).Exp(big.NewInt(1), big.NewInt(18), nil), // 1B RUSD
		PriceUSD:     1.0,
		IsStablecoin: true,
		IsVerified:   true,
	}
	
	tsci.tokens["TGR"] = tsci.tgrToken
	tsci.tokens["RUSD"] = tsci.rusdToken
	
	return tsci
}

// AddNode adds a node to the network
func (tsci *TigerSmartChainIntegration) AddNode(id, url string, stake *big.Int) error {
	tsci.mu.Lock()
	defer tsci.mu.Unlock()
	
	tsci.nodes[id] = &Node{
		ID:        id,
		URL:       url,
		IsActive:  true,
		LastSync: time.Now().Unix(),
		Stake:   stake,
	}
	
	return nil
}

// CreateBridge creates a cross-chain bridge
func (tsci *TigerSmartChainIntegration) CreateBridge(source, target string, minAmt, maxAmt *big.Int, fee float64, feePercent float64, timeEst int64) (*Bridge, error) {
	tsci.mu.Lock()
	defer tsci.mu.Unlock()
	
	bridge := &Bridge{
		ID:           fmt.Sprintf("%s_%s", source, target),
		SourceChain:  source,
		TargetChain: target,
		MinAmount:   minAmt,
		MaxAmount:  maxAmt,
		Fee:        fee,
		FeePercent: feePercent,
		TimeEstimate: timeEst,
		IsActive:    true,
	}
	
	tsci.bridges[bridge.ID] = bridge
	return bridge, nil
}

// InitiateBridge initiates a bridge transfer
func (tsci *TigerSmartChainIntegration) InitiateBridge(sender, token string, amount *big.Int, targetChain string) (string, error) {
	tsci.mu.RLock()
	defer tsci.mu.RUnlock()
	
	bridgeKey := fmt.Sprintf("%s_%s", "tigersmartchain", targetChain)
	bridge, ok := tsci.bridges[bridgeKey]
	if !ok {
		return "", fmt.Errorf("bridge not found: %s", bridgeKey)
	}
	
	if !bridge.IsActive {
		return "", fmt.Errorf("bridge not active")
	}
	
	if amount.Cmp(bridge.MinAmount) < 0 {
		return "", fmt.Errorf("amount below minimum: %s", bridge.MinAmount)
	}
	
	if amount.Cmp(bridge.MaxAmount) > 0 {
		return "", fmt.Errorf("amount above maximum: %s", bridge.MaxAmount)
	}
	
	// Calculate bridge fee
	bridgeFee := new(big.Float).SetInt(amount)
	feeFactor := new(big.Float).SetFloat64(bridge.FeePercent / 100)
	bridgeFee.Mul(bridgeFee, feeFactor)
	
	feeInt, _ := bridgeFee.Int(nil)
	feeAmount := feeInt.Add(feeInt, big.NewInt(int64(bridge.Fee)))
	
	// Record bridge fee
	FeeCollector.RecordFee(FeeTypeBridge, float64(feeAmount.Int64()), targetChain)
	
	// Generate transfer ID
	return generateTxHash(), nil
}

// GetDepositAddress gets deposit address for cross-chain deposit
func (tsci *TigerSmartChainIntegration) GetDepositAddress(user, chain string) (string, error) {
	tsci.mu.RLock()
	defer tsci.mu.RUnlock()
	
	// Generate deposit address
	return generateAddress(), nil
}

// Withdraw processes withdrawal
func (tsci *TigerSmartChainIntegration) Withdraw(recipient, token string, amount *big.Int) (string, error) {
	tsci.mu.RLock()
	defer tsci.mu.RUnlock()
	
	// Verify token
	_, ok := tsci.tokens[token]
	if !ok {
		return "", fmt.Errorf("token not found: %s", token)
	}
	
	// Process withdrawal
	return generateTxHash(), nil
}

// RegisterValidator registers a validator
func (tsci *TigerSmartChainIntegration) RegisterValidator(address string, stake *big.Int, commission float64) error {
	tsci.mu.Lock()
	defer tsci.mu.Unlock()
	
	tsci.validators[address] = &Validator{
		Address:    address,
		Stake:     stake,
		Commission: commission,
		Rewards:   big.NewInt(0),
		IsActive:  true,
		JoinedAt:  time.Now().Unix(),
	}
	
	return nil
}

// GetTGRPrice gets TGR price
func (tsci *TigerSmartChainIntegration) GetTGRPrice() float64 {
	tsci.mu.RLock()
	defer tsci.mu.RUnlock()
	
	return tsci.tgrToken.PriceUSD
}

// GetRUSDPrice gets RUSD price
func (tsci *TigerSmartChainIntegration) GetRUSDPrice() float64 {
	tsci.mu.RLock()
	defer tsci.mu.RUnlock()
	
	return tsci.rusdToken.PriceUSD
}

// ==================== Fee Collection System ====================

// Fee types
type FeeType string

const (
	FeeTypeExchange FeeType = "exchange"
	FeeTypeDEX     FeeType = "dex"
	FeeTypeBridge FeeType = "bridge"
	FeeTypeWallet FeeType = "wallet"
	FeeTypeStaking FeeType = "staking"
	FeeTypePlatform FeeType = "platform"
)

// FeeCollector collects and tracks all fees
type FeeCollector struct {
	mu           sync.RWMutex
	fees         map[FeeType]map[string]float64
	totalFees    map[FeeType]float64
	dailyFees   map[string]map[FeeType]float64
	lastReset   int64
}

var FeeCollector *FeeCollector

// NewFeeCollector creates new fee collector
func NewFeeCollector() *FeeCollector {
	return &FeeCollector{
		fees:      make(map[FeeType]map[string]float64),
		totalFees: make(map[FeeType]float64),
		dailyFees: make(map[string]map[FeeType]float64),
		lastReset: time.Now().Unix(),
	}
}

func init() {
	FeeCollector = NewFeeCollector()
}

// RecordFee records a fee
func (fc *FeeCollector) RecordFee(feeType FeeType, amount float64, chainKey string) {
	fc.mu.Lock()
	defer fc.mu.Unlock()
	
	if fc.fees[feeType] == nil {
		fc.fees[feeType] = make(map[string]float64)
	}
	
	fc.fees[feeType][chainKey] += amount
	fc.totalFees[feeType] += amount
	
	today := time.Now().Format("2006-01-02")
	if fc.dailyFees[today] == nil {
		fc.dailyFees[today] = make(map[FeeType]float64)
	}
	fc.dailyFees[today][feeType] += amount
}

// GetTotalFees gets total fees collected
func (fc *FeeCollector) GetTotalFees() map[FeeType]float64 {
	fc.mu.RLock()
	defer fc.mu.RUnlock()
	
	result := make(map[FeeType]float64)
	for k, v := range fc.totalFees {
		result[k] = v
	}
	
	return result
}

// GetChainFees gets fees by chain
func (fc *FeeCollector) GetChainFees(chainKey string) map[FeeType]float64 {
	fc.mu.RLock()
	defer fc.mu.RUnlock()
	
	result := make(map[FeeType]float64)
	for feeType, chainFees := range fc.fees {
		if amount, ok := chainFees[chainKey]; ok {
			result[feeType] = amount
		}
	}
	
	return result
}

// GetDailyFees gets daily fees
func (fc *FeeCollector) GetDailyFees() map[string]map[FeeType]float64 {
	fc.mu.RLock()
	defer fc.mu.RUnlock()
	
	result := make(map[string]map[FeeType]float64)
	for day, fees := range fc.dailyFees {
		result[day] = make(map[FeeType]float64)
		for k, v := range fees {
			result[day][k] = v
		}
	}
	
	return result
}

// ==================== Unified Integration Layer ====================

// UnifiedIntegration combines all products
type UnifiedIntegration struct {
	*tigerWalletIntegration
	*tigerswapIntegration
	*tigerSmartChainIntegration
	
	mu           sync.RWMutex
	chains      map[string]*ChainConfig
	router      *CrossChainRouter
	stats       IntegrationStats
}

type CrossChainRouter struct {
	mu      sync.RWMutex
	routes  map[string]RouteStep
}

type RouteStep struct {
	FromChain string
	ToChain  string
	Action   string // "bridge" or "swap"
	PoolID   string
}

type IntegrationStats struct {
	TotalTransactions uint64
	TotalVolume      float64
	TotalUsers      uint64
	LastUpdate     int64
}

// NewUnifiedIntegration creates unified integration
func NewUnifiedIntegration() *UnifiedIntegration {
	ui := &UnifiedIntegration{
		tigerWalletIntegration:      NewTigerWalletIntegration(),
		tigerswapIntegration:      NewTigerswapIntegration(),
		tigerSmartChainIntegration: NewTigerSmartChainIntegration(),
		chains:                  make(map[string]*ChainConfig),
		router:                  &CrossChainRouter{routes: make(map[string]RouteStep)},
	}
	
	// Initialize default chains
	ui.initializeDefaultChains()
	
	return ui
}

// initializeDefaultChains initializes default chains
func (ui *UnifiedIntegration) initializeDefaultChains() {
	chains := []ChainConfig{
		// TigerSmartChain (Native)
		{ID: 2024, Key: "tigersmartchain", Name: "TigerSmartChain", Type: ChainTypeEVM, Symbol: "TGR", Decimals: 18, IsActive: true, IsNative: true},
		// EVM Chains
		{ID: 1, Key: "ethereum", Name: "Ethereum", Type: ChainTypeEVM, Symbol: "ETH", Decimals: 18, IsActive: true},
		{ID: 56, Key: "bsc", Name: "BNB Smart Chain", Type: ChainTypeEVM, Symbol: "BNB", Decimals: 18, IsActive: true},
		{ID: 137, Key: "polygon", Name: "Polygon", Type: ChainTypeEVM, Symbol: "MATIC", Decimals: 18, IsActive: true},
		{ID: 43114, Key: "avalanche", Name: "Avalanche", Type: ChainTypeEVM, Symbol: "AVAX", Decimals: 18, IsActive: true},
		{ID: 250, Key: "fantom", Name: "Fantom", Type: ChainTypeEVM, Symbol: "FTM", Decimals: 18, IsActive: true},
		{ID: 42161, Key: "arbitrum", Name: "Arbitrum One", Type: ChainTypeEVM, Symbol: "ETH", Decimals: 18, IsActive: true},
		{ID: 10, Key: "optimism", Name: "Optimism", Type: ChainTypeEVM, Symbol: "ETH", Decimals: 18, IsActive: true},
		{ID: 8453, Key: "base", Name: "Base", Type: ChainTypeEVM, Symbol: "ETH", Decimals: 18, IsActive: true},
		{ID: 42220, Key: "celo", Name: "Celo", Type: ChainTypeEVM, Symbol: "CELO", Decimals: 18, IsActive: true},
		{ID: 100, Key: "gnosis", Name: "Gnosis Chain", Type: ChainTypeEVM, Symbol: "XDAI", Decimals: 18, IsActive: true},
		// Non-EVM Chains
		{ID: 101, Key: "solana", Name: "Solana", Type: ChainTypeSolana, Symbol: "SOL", Decimals: 9, IsActive: true},
		{ID: 1313161555, Key: "near", Name: "NEAR Protocol", Type: ChainTypeNear, Symbol: "NEAR", Decimals: 24, IsActive: true},
		{ID: 0, Key: "aptos", Name: "Aptos", Type: ChainTypeAptos, Symbol: "APT", Decimals: 8, IsActive: true},
		{ID: 0, Key: "sui", Name: "Sui", Type: ChainTypeSui, Symbol: "SUI", Decimals: 9, IsActive: true},
	}
	
	for _, chain := range chains {
		ui.chains[chain.Key] = &chain
		ui.tigerWalletIntegration.AddChain(chain)
	}
	
	// Add tokens
	tokens := []TokenConfig{
		// Tiger Ecosystem
		{Symbol: "TGR", Name: "Tiger Coin", Decimals: 18, ChainKey: "tigersmartchain", IsNative: true, PriceUSD: 0.05, IsVerified: true},
		{Symbol: "RUSD", Name: "Royal Tiger USD", Decimals: 18, ChainKey: "tigersmartchain", IsStablecoin: true, PriceUSD: 1.0, IsVerified: true},
		// Top tokens
		{Symbol: "ETH", Name: "Ethereum", Decimals: 18, ChainKey: "ethereum", PriceUSD: 3000.0, IsVerified: true},
		{Symbol: "BNB", Name: "BNB", Decimals: 18, ChainKey: "bsc", PriceUSD: 600.0, IsVerified: true},
		{Symbol: "SOL", Name: "Solana", Decimals: 9, ChainKey: "solana", PriceUSD: 150.0, IsVerified: true},
		{Symbol: "USDT", Name: "Tether USD", Decimals: 6, ChainKey: "ethereum", IsStablecoin: true, PriceUSD: 1.0, IsVerified: true},
		{Symbol: "USDC", Name: "USD Coin", Decimals: 6, ChainKey: "ethereum", IsStablecoin: true, PriceUSD: 1.0, IsVerified: true},
	}
	
	for _, token := range tokens {
		ui.tigerswapIntegration.AddToken(token)
	}
	
	// Create default pools
	defaultPools := [][3]string{
		{"TGR", "USDT", "tigersmartchain"},
		{"TGR", "RUSD", "tigersmartchain"},
		{"TGR", "ETH", "tigersmartchain"},
		{"RUSD", "USDT", "tigersmartchain"},
		{"ETH", "USDT", "ethereum"},
		{"BNB", "USDT", "bsc"},
	}
	
	for _, pool := range defaultPools {
		ui.tigerswapIntegration.CreatePool(pool[0], pool[1], pool[2], 0.003)
	}
	
	// Create bridges
	ui.tigerSmartChainIntegration.CreateBridge("tigersmartchain", "ethereum", 
		big.NewInt(100000000000000000), // 0.1 TGR min
		big.NewInt(100000000000000000000), // 100 TGR max
		0.001, 0.1, 300) // 0.1% fee, 5 min
	
	ui.tigerSmartChainIntegration.CreateBridge("tigersmartchain", "bsc",
		big.NewInt(100000000000000000),
		big.NewInt(100000000000000000000),
		0.001, 0.1, 300)
}

// CrossChainSwap performs cross-chain swap
func (ui *UnifiedIntegration) CrossChainSwap(fromChain, toChain, tokenIn, tokenOut string, amount *big.Int) (*big.Int, error) {
	ui.mu.Lock()
	defer ui.mu.Unlock()
	
	// Route: fromChain -> bridge -> tigersmartchain -> swap -> toChain
	var output *big.Int
	var err error
	
	// Step 1: Bridge if different chain
	if fromChain != "tigersmartchain" {
		_, err = ui.tigerSmartChainIntegration.InitiateBridge("", tokenIn, amount, "tigersmartchain")
		if err != nil {
			return nil, err
		}
	}
	
	// Step 2: Swap on TigerSmartChain
	output, err = ui.tigerswapIntegration.Swap(tokenIn, tokenOut, "tigersmartchain", amount)
	if err != nil {
		return nil, err
	}
	
	// Step 3: Bridge to target chain
	if toChain != "tigersmartchain" {
		_, err = ui.tigerSmartChainIntegration.InitiateBridge("", tokenOut, output, toChain)
		if err != nil {
			return nil, err
		}
	}
	
	ui.stats.TotalVolume += float64(output.Int64())
	ui.stats.TotalTransactions++
	
	return output, nil
}

// GetSupportedChains gets all supported chains
func (ui *UnifiedIntegration) GetSupportedChains() []ChainConfig {
	ui.mu.RLock()
	defer ui.mu.RUnlock()
	
	result := make([]ChainConfig, 0, len(ui.chains))
	for _, chain := range ui.chains {
		result = append(result, *chain)
	}
	
	return result
}

// AddChain adds a new chain at runtime
func (ui *UnifiedIntegration) AddChain(config ChainConfig) error {
	ui.mu.Lock()
	defer ui.mu.Unlock()
	
	ui.chains[config.Key] = &config
	return ui.tigerWalletIntegration.AddChain(config)
}

// GetStats gets integration statistics
func (ui *UnifiedIntegration) GetStats() IntegrationStats {
	ui.mu.RLock()
	defer ui.mu.RUnlock()
	
	ui.stats.LastUpdate = time.Now().Unix()
	return ui.stats
}

// ==================== Helper Functions ====================

func generateAddress() string {
	// In production, use proper cryptographic address generation
	return "0x" + randomHex(40)
}

func generatePublicKey() string {
	return "0x04" + randomHex(128)
}

func generateTxHash() string {
	return "0x" + randomHex(64)
}

func signMessage(msg string) string {
	// In production, use proper cryptographic signing
	return randomHex(130)
}

func randomHex(n int) string {
	const hexChars = "0123456789abcdef"
	result := make([]byte, n)
	for i := 0; i < n; i++ {
		result[i] = hexChars[time.Now().UnixNano()%16]
	}
	return string(result)
}

func calculateSwapOutput(amountIn, reserveA, reserveB *big.Int) *big.Int {
	// Simplified AMM formula: dy = (y * dx) / (x + dx)
	amountInMul := new(big.Int).Mul(amountIn, reserveB)
	return amountInMul.Div(amountInMul, new(big.Int).Add(reserveA, amountIn))
}

func calculatePriceImpact(amountIn, reserveA *big.Int) float64 {
	// Simplified price impact calculation
	ratio := new(big.Float).SetInt(amountIn)
	reserve := new(big.Float).SetInt(reserveA)
	ratio.Div(ratio, reserve)
	
	f, _ := ratio.Float64()
	return f * 100
}

// ==================== API Handlers ====================

type APIResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

func (ui *UnifiedIntegration) HandleAPI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	
	var resp APIResponse
	
	// Route handlers based on request path
	switch r.URL.Path {
	case "/api/chains":
		resp = APIResponse{Success: true, Data: ui.GetSupportedChains()}
	case "/api/stats":
		resp = APIResponse{Success: true, Data: ui.GetStats()}
	case "/api/fees":
		resp = APIResponse{Success: true, Data: FeeCollector.GetTotalFees()}
	case "/api/tgr-price":
		resp = APIResponse{Success: true, Data: map[string]float64{"price": ui.tigerSmartChainIntegration.GetTGRPrice()}}
	case "/api/rusd-price":
		resp = APIResponse{Success: true, Data: map[string]float64{"price": ui.tigerSmartChainIntegration.GetRUSDPrice()}}
	default:
		resp = APIResponse{Success: false, Error: "not found"}
	}
	
	json.NewEncoder(w).Encode(resp)
}

func main() {
	// Initialize unified integration
	ui := NewUnifiedIntegration()
	
	fmt.Println("TigerEx Unified Integration Layer Started")
	fmt.Printf("Supported Chains: %d\n", len(ui.GetSupportedChains()))
	fmt.Printf("Fee Collection: %v\n", FeeCollector.GetTotalFees())
	
	// In production, start HTTP server
	// http.HandleFunc("/", ui.HandleAPI)
	// http.ListenAndServe(":8080", nil)
}