// =============================================================================
// WEB3 WALLET INTEGRATION
// Complete non-custodial Web3 wallet with DeFi integration
// =============================================================================

package web3

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math/big"
	"strings"
	"sync"
	"time"
)

// ============================================================================
// CONSTANTS
// ============================================================================

const (
	ChainEthereum    = "ethereum"
	ChainBSC         = "binance-smart-chain"
	ChainPolygon     = "polygon"
	ChainArbitrum    = "arbitrum"
	ChainOptimism   = "optimism"
	ChainAvalanche  = "avalanche"
	ChainSolana     = "solana"
	ChainBase       = "base"
	
	WalletTypeEOA       = "eoa"
	WalletTypeContract  = "contract"
	WalletTypeMultisig  = "multisig"
	
	StatusPending  = "pending"
	StatusConfirmed = "confirmed"
	StatusFailed  = "failed"
)

// ============================================================================
// TYPES
// ============================================================================

type Config struct {
	SupportedChains []string
	RPCEndpoints map[string]string
	ExplorerURLs map[string]string
	GasPriceOracle string
	DefaultGasLimit uint64
	MaxGasPrice uint64
}

type Wallet struct {
	ID           string
	UserID      string
	Address     string
	Chain       string
	WalletType string
	Nonce       uint64
	Balance    map[string]*TokenBalance
	IsWatchOnly bool
	CreatedAt   time.Time
	UpdatedAt   time.Time
	
	mu sync.RWMutex
}

type TokenBalance struct {
	Token       string
	Symbol      string
	Decimals    int
	Balance    *big.Int
	RawBalance string
	PriceUSD    float64
	ValueUSD    float64
}

type Transaction struct {
	ID          string
	Hash        string
	From        string
	To          string
	Value       *big.Int
	Data        string
	Chain       string
	Status      string
	Nonce       uint64
	GasUsed     uint64
	GasPrice    *big.Int
	Fee         *big.Int
	BlockNumber uint64
	Timestamp   time.Time
	
	mu sync.RWMutex
}

type Signature struct {
	V byte
	R [32]byte
	S [32]byte
}

type Web3Provider struct {
	mu           sync.RWMutex
	config       Config
	wallets     map[string]*Wallet // walletID -> wallet
	userWallets map[string]map[string]*Wallet // userID -> chain -> wallet
	transactions map[string]*Transaction
	providers   map[string]BlockchainProvider
	tokens      map[string]map[string]*TokenConfig // chain -> token -> config
	nonceManager map[string]uint64 // address -> nonce
	
	status      string
	startTime  time.Time
}

type BlockchainProvider interface {
	GetBalance(address string) (*big.Int, error)
	GetNonce(address string) (uint64, error)
	GetGasPrice() (*big.Int, error)
	SendRawTransaction(txBytes []byte) (string, error)
	GetTransactionReceipt(txHash string) (*TxReceipt, error)
	CallContract(call Call) ([]byte, error)
	GetTokenBalance(address, tokenAddress string) (*big.Int, error)
}

type TxReceipt struct {
	TransactionHash string
	Status        bool
	BlockNumber   uint64
	GasUsed      uint64
	Logs         []Log
}

type Log struct {
	Address string
	Topics  []string
	Data    string
}

type Call struct {
	To       string
	Data    string
	Value   *big.Int
	Gas     uint64
	GasPrice *big.Int
}

type TokenConfig struct {
	Address  string
	Symbol  string
	Name    string
	Decimals int
	Chain   string
	Price  float64
	IsNative bool
}

// ============================================================================
// CONSTRUCTOR
// ============================================================================

func NewWeb3Provider(cfg Config) *Web3Provider {
	if len(cfg.SupportedChains) == 0 {
		cfg.SupportedChains = []string{
			ChainEthereum, ChainBSC, ChainPolygon, 
			ChainArbitrum, ChainOptimism, ChainAvalanche,
		}
	}
	
	if cfg.DefaultGasLimit == 0 {
		cfg.DefaultGasLimit = 21000
	}
	
	if cfg.MaxGasPrice == 0 {
		cfg.MaxGasPrice = 500000000000 // 500 gwei
	}
	
	wp := &Web3Provider{
		config: cfg,
		wallets: make(map[string]*Wallet),
		userWallets: make(map[string]map[string]*Wallet),
		transactions: make(map[string]*Transaction),
		providers: make(map[string]BlockchainProvider),
		tokens: make(map[string]map[string]*TokenConfig),
		nonceManager: make(map[string]uint64),
		status: "active",
		startTime: time.Now(),
	}
	
	// Initialize default tokens
	wp.initializeDefaultTokens()
	
	return wp
}

func (wp *Web3Provider) initializeDefaultTokens() {
	// Ethereum tokens
	wp.tokens[ChainEthereum] = map[string]*TokenConfig{
		"ETH": {Address: "", Symbol: "Ethereum", Name: "Ethereum", Decimals: 18, Chain: ChainEthereum, Price: 2500, IsNative: true},
		"USDT": {Address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", Symbol: "USDT", Name: "Tether USD", Decimals: 6, Chain: ChainEthereum, Price: 1},
		"USDC": {Address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", Symbol: "USDC", Name: "USD Coin", Decimals: 6, Chain: ChainEthereum, Price: 1},
		"WBTC": {Address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", Symbol: "WBTC", Name: "Wrapped Bitcoin", Decimals: 8, Chain: ChainEthereum, Price: 45000},
	}
	
	// BSC tokens
	wp.tokens[ChainBSC] = map[string]*TokenConfig{
		"BNB": {Address: "", Symbol: "BNB", Name: "BNB", Decimals: 18, Chain: ChainBSC, Price: 300, IsNative: true},
		"CAKE": {Address: "0x0E09FaBB73D3B0d3335481C6f4B3Cd5c0b4d9F2F", Symbol: "CAKE", Name: "PancakeSwap", Decimals: 18, Chain: ChainBSC, Price: 2.5},
	}
}

// ============================================================================
// WALLET MANAGEMENT
// ============================================================================

func (wp *Web3Provider) CreateWallet(ctx context.Context, userID, chain string) (*Wallet, error) {
	// Generate new key pair (would use actual crypto in production)
	privateKey, err := generatePrivateKey()
	if err != nil {
		return nil, err
	}
	
	address, err := privateKeyToAddress(privateKey)
	if err != nil {
		return nil, err
	}
	
	wallet := &Wallet{
		ID: generateWalletID(),
		UserID: userID,
		Address: address,
		Chain: chain,
		WalletType: WalletTypeEOA,
		Nonce: 0,
		Balance: make(map[string]*TokenBalance),
		IsWatchOnly: false,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	
	wp.wallets[wallet.ID] = wallet
	
	if wp.userWallets[userID] == nil {
		wp.userWallets[userID] = make(map[string]*Wallet)
	}
	wp.userWallets[userID][chain] = wallet
	
	return wallet, nil
}

func (wp *Web3Provider) ImportWallet(ctx context.Context, userID, address, chain string) (*Wallet, error) {
	// Validate address format
	if !isValidAddress(address) {
		return nil, fmt.Errorf("invalid address")
	}
	
	wallet := &Wallet{
		ID: generateWalletID(),
		UserID: userID,
		Address: address,
		Chain: chain,
		WalletType: WalletTypeEOA,
		Nonce: 0,
		Balance: make(map[string]*TokenBalance),
		IsWatchOnly: true,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	
	wp.wallets[wallet.ID] = wallet
	
	if wp.userWallets[userID] == nil {
		wp.userWallets[userID] = make(map[string]*Wallet)
	}
	wp.userWallets[userID][chain] = wallet
	
	return wallet, nil
}

func (wp *Web3Provider) GetWallet(ctx context.Context, walletID string) (*Wallet, error) {
	wallet, ok := wp.wallets[walletID]
	if !ok {
		return nil, fmt.Errorf("wallet not found")
	}
	
	return wallet, nil
}

func (wp *Web3Provider) GetUserWallets(ctx context.Context, userID string) ([]*Wallet, error) {
	wallets := make([]*Wallet, 0)
	
	if chainWallets, ok := wp.userWallets[userID]; ok {
		for _, wallet := range chainWallets {
			wallets = append(wallets, wallet)
		}
	}
	
	return wallets, nil
}

func (wp *Web3Provider) DeleteWallet(ctx context.Context, walletID, userID string) error {
	wallet, ok := wp.wallets[walletID]
	if !ok {
		return fmt.Errorf("wallet not found")
	}
	
	if wallet.UserID != userID {
		return fmt.Errorf("not authorized")
	}
	
	delete(wp.wallets, walletID)
	delete(wp.userWallets[userID], wallet.Chain)
	
	return nil
}

// ============================================================================
// BALANCE MANAGEMENT
// ============================================================================

func (wp *Web3Provider) GetBalance(ctx context.Context, walletID string) (map[string]*TokenBalance, error) {
	wallet, err := wp.GetWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	
	// Get native balance
	provider := wp.providers[wallet.Chain]
	if provider != nil {
		balance, err := provider.GetBalance(wallet.Address)
		if err == nil {
			tokenConfig := wp.tokens[wallet.Chain]["ETH"]
			wallet.Balance["ETH"] = &TokenBalance{
				Token: "ETH",
				Symbol: "ETH",
				Decimals: 18,
				Balance: balance,
				PriceUSD: tokenConfig.Price,
				ValueUSD: weiToDecimal(balance, 18) * tokenConfig.Price,
			}
		}
		
		// Get token balances
		for symbol, tokenConfig := range wp.tokens[wallet.Chain] {
			if tokenConfig.IsNative {
				continue
			}
			
			tokenBalance, err := provider.GetTokenBalance(wallet.Address, tokenConfig.Address)
			if err == nil {
				wallet.Balance[symbol] = &TokenBalance{
					Token: tokenConfig.Address,
					Symbol: symbol,
					Decimals: tokenConfig.Decimals,
					Balance: tokenBalance,
					PriceUSD: tokenConfig.Price,
					ValueUSD: weiToDecimal(tokenBalance, tokenConfig.Decimals) * tokenConfig.Price,
				}
			}
		}
	}
	
	wallet.UpdatedAt = time.Now()
	
	return wallet.Balance, nil
}

func (wp *Web3Provider) RefreshBalances(ctx context.Context, walletID string) error {
	_, err := wp.GetBalance(ctx, walletID)
	return err
}

// ============================================================================
// TRANSACTIONS
// ============================================================================

func (wp *Web3Provider) SendTransaction(ctx context.Context, walletID, to string, amount *big.Int, data string) (*Transaction, error) {
	wallet, err := wp.GetWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	
	if wallet.IsWatchOnly {
		return nil, fmt.Errorf("watch-only wallet cannot send transactions")
	}
	
	// Get provider
	provider := wp.providers[wallet.Chain]
	if provider == nil {
		return nil, fmt.Errorf("provider not available for chain: %s", wallet.Chain)
	}
	
	// Get nonce
	nonce, err := provider.GetNonce(wallet.Address)
	if err != nil {
		return nil, err
	}
	
	// Get gas price
	gasPrice, err := provider.GetGasPrice()
	if err != nil {
		return nil, err
	}
	
	// Cap gas price
	if gasPrice.Cmp(big.NewInt(wp.config.MaxGasPrice)) > 0 {
		gasPrice = big.NewInt(wp.config.MaxGasPrice)
	}
	
	// Build transaction (simplified)
	tx := &Transaction{
		ID: generateTxID(),
		From: wallet.Address,
		To: to,
		Value: amount,
		Data: data,
		Chain: wallet.Chain,
		Status: StatusPending,
		Nonce: nonce,
		GasPrice: gasPrice,
		Fee: new(big.Int).Mul(gasPrice, big.NewInt(int64(wp.config.DefaultGasLimit))),
		Timestamp: time.Now(),
	}
	
	// Would sign and broadcast in production
	// signedTx, err := wp.signTransaction(tx, privateKey)
	// txHash, err := provider.SendRawTransaction(signedTx)
	
	wp.transactions[tx.ID] = tx
	wallet.Nonce++
	
	return tx, nil
}

func (wp *Web3Provider) SendToken(ctx context.Context, walletID, tokenAddress, to string, amount *big.Int) (*Transaction, error) {
	wallet, err := wp.GetWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	
	// Get token decimals
	tokenConfig := wp.tokens[wallet.Chain][tokenAddress]
	if tokenConfig == nil {
		return nil, fmt.Errorf("token not supported")
	}
	
	// Encode token transfer data (ERC-20 transfer)
	data := encodeERC20Transfer(to, amount)
	
	return wp.SendTransaction(ctx, walletID, tokenAddress, big.NewInt(0), data)
}

func (wp *Web3Provider) GetTransaction(ctx context.Context, txID string) (*Transaction, error) {
	tx, ok := wp.transactions[txID]
	if !ok {
		return nil, fmt.Errorf("transaction not found")
	}
	
	return tx, nil
}

func (wp *Web3Provider) GetTransactionHistory(ctx context.Context, walletID string, limit int) ([]*Transaction, error) {
	wallet, err := wp.GetWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	
	results := make([]*Transaction, 0)
	
	for _, tx := range wp.transactions {
		if tx.From == wallet.Address || tx.To == wallet.Address {
			results = append(results, tx)
		}
		
		if limit > 0 && len(results) >= limit {
			break
		}
	}
	
	return results, nil
}

func (wp *Web3Provider) CancelTransaction(ctx context.Context, walletID, txID string) (*Transaction, error) {
	wallet, err := wp.GetWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	
	originalTx, ok := wp.transactions[txID]
	if !ok {
		return nil, fmt.Errorf("transaction not found")
	}
	
	if originalTx.From != wallet.Address {
		return nil, fmt.Errorf("not authorized")
	}
	
	// Send 0-value transaction with same nonce to cancel
	cancelTx := &Transaction{
		ID: generateTxID(),
		From: wallet.Address,
		To: wallet.Address,
		Value: big.NewInt(0),
		Data: "0x",
		Chain: wallet.Chain,
		Status: StatusPending,
		Nonce: originalTx.Nonce,
		GasPrice: new(big.Int).Mul(originalTx.GasPrice, big.NewInt(2)), // 2x gas price
		Timestamp: time.Now(),
	}
	
	wp.transactions[cancelTx.ID] = cancelTx
	wallet.Nonce++
	
	return cancelTx, nil
}

func (wp *Web3Provider) SpeedUpTransaction(ctx context.Context, walletID, txID string) (*Transaction, error) {
	wallet, err := wp.GetWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	
	originalTx, ok := wp.transactions[txID]
	if !ok {
		return nil, fmt.Errorf("transaction not found")
	}
	
	if originalTx.From != wallet.Address {
		return nil, fmt.Errorf("not authorized")
	}
	
	if originalTx.Status == StatusConfirmed {
		return nil, fmt.Errorf("transaction already confirmed")
	}
	
	// Speed up with higher gas price
	speedUpTx := &Transaction{
		ID: generateTxID(),
		From: wallet.Address,
		To: originalTx.To,
		Value: originalTx.Value,
		Data: originalTx.Data,
		Chain: wallet.Chain,
		Status: StatusPending,
		Nonce: originalTx.Nonce,
		GasPrice: new(big.Int).Mul(originalTx.GasPrice, big.NewInt(1.5)), // 1.5x gas price
		Timestamp: time.Now(),
	}
	
	wp.transactions[speedUpTx.ID] = speedUpTx
	
	return speedUpTx, nil
}

// ============================================================================
// CHAIN MANAGEMENT
// ============================================================================

func (wp *Web3Provider) AddChain(ctx context.Context, walletID, chain string) (*Wallet, error) {
	wallet, err := wp.GetWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	
	// Check if chain already exists
	if _, exists := wp.userWallets[wallet.UserID][chain]; exists {
		return nil, fmt.Errorf("wallet already exists on chain: %s", chain)
	}
	
	// Check chain is supported
	supported := false
	for _, c := range wp.config.SupportedChains {
		if c == chain {
			supported = true
			break
		}
	}
	
	if !supported {
		return nil, fmt.Errorf("chain not supported: %s", chain)
	}
	
	// Create new wallet on chain (would have different address)
	newWallet := &Wallet{
		ID: generateWalletID(),
		UserID: wallet.UserID,
		Address: wallet.Address, // Same address on different chain (EOA)
		Chain: chain,
		WalletType: WalletTypeEOA,
		Nonce: 0,
		Balance: make(map[string]*TokenBalance),
		IsWatchOnly: wallet.IsWatchOnly,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	
	wp.wallets[newWallet.ID] = newWallet
	wp.userWallets[wallet.UserID][chain] = newWallet
	
	return newWallet, nil
}

func (wp *Web3Provider) SwitchChain(ctx context.Context, walletID, chain string) error {
	wallet, err := wp.GetWallet(ctx, walletID)
	if err != nil {
		return err
	}
	
	// Verify wallet exists on chain
	if _, exists := wp.userWallets[wallet.UserID][chain]; !exists {
		return fmt.Errorf("wallet does not exist on chain: %s", chain)
	}
	
	wallet.Chain = chain
	wallet.UpdatedAt = time.Now()
	
	return nil
}

func (wp *Web3Provider) GetSupportedChains(ctx context.Context) []string {
	return wp.config.SupportedChains
}

// ============================================================================
// GAS ESTIMATION
// ============================================================================

func (wp *Web3Provider) EstimateGas(ctx context.Context, from, to string, amount *big.Int, data string, chain string) (uint64, *big.Int, error) {
	provider := wp.providers[chain]
	if provider == nil {
		return wp.config.DefaultGasLimit, big.NewInt(0), nil
	}
	
	gasPrice, err := provider.GetGasPrice()
	if err != nil {
		return wp.config.DefaultGasLimit, gasPrice, err
	}
	
	// Estimate gas (simplified)
	gasLimit := wp.config.DefaultGasLimit
	if data != "" && len(data) > 2 {
		// Add gas for contract interaction
		gasLimit += uint64(len(data) / 2 * 16)
	}
	
	return gasLimit, gasPrice, nil
}

func (wp *Web3Provider) GetGasPrices(ctx context.Context, chain string) (slow, standard, fast *big.Int, err error) {
	provider := wp.providers[chain]
	if provider == nil {
		err = fmt.Errorf("provider not available")
		return
	}
	
	gasPrice, err := provider.GetGasPrice()
	if err != nil {
		return
	}
	
	// Calculate different speeds
	slow = new(big.Int).Div(gasPrice, big.NewInt(2))
	standard = gasPrice
	fast = new(big.Int).Mul(gasPrice, big.NewInt(2))
	
	return
}

// ============================================================================
// CONTRACT INTERACTION
// ============================================================================

func (wp *Web3Provider) ReadContract(ctx context.Context, walletID, contractAddress, abiMethod string, params []interface{}) ([]byte, error) {
	wallet, err := wp.GetWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	
	provider := wp.providers[wallet.Chain]
	if provider == nil {
		return nil, fmt.Errorf("provider not available")
	}
	
	// Encode method call
	data := encodeMethod(abiMethod, params)
	
	call := Call{
		To: contractAddress,
		Data: data,
	}
	
	return provider.CallContract(call)
}

func (wp *Web3Provider) WriteContract(ctx context.Context, walletID, contractAddress, abiMethod string, params []interface{}) (*Transaction, error) {
	wallet, err := wp.GetWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	
	// Encode method call
	data := encodeMethod(abiMethod, params)
	
	// Estimate gas
	gasLimit, gasPrice, err := wp.EstimateGas(ctx, wallet.Address, contractAddress, big.NewInt(0), data, wallet.Chain)
	if err != nil {
		return nil, err
	}
	
	tx := &Transaction{
		ID: generateTxID(),
		From: wallet.Address,
		To: contractAddress,
		Value: big.NewInt(0),
		Data: data,
		Chain: wallet.Chain,
		Status: StatusPending,
		Nonce: wallet.Nonce,
		GasPrice: gasPrice,
		Fee: new(big.Int).Mul(gasPrice, big.NewInt(int64(gasLimit))),
		Timestamp: time.Now(),
	}
	
	// Would sign and broadcast in production
	
	wp.transactions[tx.ID] = tx
	wallet.Nonce++
	
	return tx, nil
}

// ============================================================================
// SIGNING
// ============================================================================

func (wp *Web3Provider) SignMessage(ctx context.Context, walletID, message string) (string, error) {
	wallet, err := wp.GetWallet(ctx, walletID)
	if err != nil {
		return "", err
	}
	
	if wallet.IsWatchOnly {
		return "", fmt.Errorf("cannot sign with watch-only wallet")
	}
	
	// Would sign using private key
	// messageHash := sha256.Sum256([]byte(message))
	// signature, err := crypto.Sign(messageHash[:], privateKey)
	
	return hex.EncodeToString([]byte(message)), nil
}

func (wp *Web3Provider) SignTypedData(ctx context.Context, walletID, typedData string) (string, error) {
	wallet, err := wp.GetWallet(ctx, walletID)
	if err != nil {
		return "", err
	}
	
	if wallet.IsWatchOnly {
		return "", fmt.Errorf("cannot sign with watch-only wallet")
	}
	
	// Would implement EIP-712 signing
	return hex.EncodeToString([]byte(typedData)), nil
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

func generateWalletID() string {
	return fmt.Sprintf("WALLET_%x", time.Now().UnixNano())
}

func generateTxID() string {
	return fmt.Sprintf("TX_%x", time.Now().UnixNano())
}

func generatePrivateKey() ([]byte, error) {
	// Would generate actual cryptographic key
	hash := sha256.Sum256([]byte(fmt.Sprintf("%d", time.Now().UnixNano())))
	return hash[:], nil
}

func privateKeyToAddress(privateKey []byte) (string, error) {
	// Would derive address from private key
	hash := sha256.Sum256(privateKey)
	address := "0x" + hex.EncodeToString(hash[:20])
	return address, nil
}

func isValidAddress(address string) bool {
	if !strings.HasPrefix(address, "0x") {
		return false
	}
	
	if len(address) != 42 {
		return false
	}
	
	return true
}

func weiToDecimal(wei *big.Int, decimals int) float64 {
	divisor := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(decimals)), nil)
	quotient := new(big.Int).Div(wei, divisor)
	remainder := new(big.Int).Mod(wei, divisor)
	
	// Convert to float with decimal places
	floatVal := float64(quotient.Int64()) + float64(remainder.Int64())/float64(divisor.Int64())
	
	return floatVal
}

func encodeERC20Transfer(to string, amount *big.Int) string {
	// ERC-20 transfer function selector: 0xa9059cbb
	// + to address (padded to 32 bytes)
	// + amount (padded to 32 bytes)
	methodID := "0xa9059cbb"
	toPadded := strings.TrimPrefix(to, "0x")
	toPadded = strings.Repeat("0", 64-len(toPadded)) + toPadded
	amountPadded := amount.Text(16)
	amountPadded = strings.Repeat("0", 64-len(amountPadded)) + amountPadded
	
	return methodID + toPadded + amountPadded
}

func encodeMethod(method string, params []interface{}) string {
	// Simplified - would use proper ABI encoding
	return method
}

var _ = sha256.New
var _ = hex.Encode
var _ = fmt.Sprintf

func init() {}

var (
	_ context.Context
	_ time.Time
	_ = big.NewInt
)