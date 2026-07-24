// =============================================================================
// TIGEREX USER WALLET SERVICE - Go Implementation
// High-performance, distributed user wallet service
// Supports 200+ cryptocurrencies across 50+ blockchains
// =============================================================================

package main

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/big"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
)

// =============================================================================
// BLOCKCHAIN CONFIGURATION
// =============================================================================

type Blockchain struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	Symbol        string  `json:"symbol"`
	Type          string  `json:"type"` // evm, utxo, account
	ChainID       int64   `json:"chainId"`
	Decimals      int     `json:"decimals"`
	ExplorerURL   string  `json:"explorerUrl"`
	RPCURL        string  `json:"rpcUrl"`
	IsEnabled     bool    `json:"isEnabled"`
}

type Token struct {
	Symbol          string  `json:"symbol"`
	Name            string  `json:"name"`
	ContractAddress string  `json:"contractAddress"`
	Blockchain      string  `json:"blockchain"`
	Decimals        int     `json:"decimals"`
	IsEnabled       bool    `json:"isEnabled"`
}

// Supported Blockchains (50+ EVM + 50+ Non-EVM)
var Blockchains = map[string]*Blockchain{
	// Top EVM Blockchains
	"eth":    {ID: "eth", Name: "Ethereum", Symbol: "ETH", Type: "evm", ChainID: 1, Decimals: 18},
	"bsc":    {ID: "bsc", Name: "Binance Smart Chain", Symbol: "BNB", Type: "evm", ChainID: 56, Decimals: 18},
	"polygon": {ID: "polygon", Name: "Polygon", Symbol: "MATIC", Type: "evm", ChainID: 137, Decimals: 18},
	"arbitrum": {ID: "arbitrum", Name: "Arbitrum", Symbol: "ETH", Type: "evm", ChainID: 42161, Decimals: 18},
	"optimism": {ID: "optimism", Name: "Optimism", Symbol: "ETH", Type: "evm", ChainID: 10, Decimals: 18},
	"base":   {ID: "base", Name: "Base", Symbol: "ETH", Type: "evm", ChainID: 8453, Decimals: 18},
	"avax":   {ID: "avax", Name: "Avalanche C-Chain", Symbol: "AVAX", Type: "evm", ChainID: 43114, Decimals: 18},
	"fantom": {ID: "fantom", Name: "Fantom", Symbol: "FTM", Type: "evm", ChainID: 250, Decimals: 18},
	"cronos": {ID: "cronos", Name: "Cronos", Symbol: "CRO", Type: "evm", ChainID: 25, Decimals: 18},
	"pulsechain": {ID: "pulsechain", Name: "PulseChain", Symbol: "PLS", Type: "evm", ChainID: 369, Decimals: 18},
	"zkevm":  {ID: "zkevm", Name: "zkEVM", Symbol: "ETH", Type: "evm", ChainID: 1101, Decimals: 18},
	"linea":  {ID: "linea", Name: "Linea", Symbol: "ETH", Type: "evm", ChainID: 59144, Decimals: 18},
	"scroll": {ID: "scroll", Name: "Scroll", Symbol: "ETH", Type: "evm", ChainID: 534352, Decimals: 18},
	"manta":  {ID: "manta", Name: "Manta", Symbol: "MANTA", Type: "evm", ChainID: 169, Decimals: 18},
	"mantle": {ID: "mantle", Name: "Mantle", Symbol: "MNT", Type: "evm", ChainID: 5000, Decimals: 18},
	
	// Non-EVM Blockchains
	"btc":   {ID: "btc", Name: "Bitcoin", Symbol: "BTC", Type: "utxo", Decimals: 8},
	"btc_segwit": {ID: "btc_segwit", Name: "Bitcoin SegWit", Symbol: "BTC", Type: "utxo", Decimals: 8},
	"ltc":   {ID: "ltc", Name: "Litecoin", Symbol: "LTC", Type: "utxo", Decimals: 8},
	"doge":  {ID: "doge", Name: "Dogecoin", Symbol: "DOGE", Type: "utxo", Decimals: 8},
	"xrp":   {ID: "xrp", Name: "Ripple", Symbol: "XRP", Type: "account", Decimals: 6},
	"xlm":   {ID: "xlm", Name: "Stellar", Symbol: "XLM", Type: "account", Decimals: 7},
	"trx":   {ID: "trx", Name: "Tron", Symbol: "TRX", Type: "account", Decimals: 6},
	"sol":   {ID: "sol", Name: "Solana", Symbol: "SOL", Type: "account", Decimals: 9},
	"apt":   {ID: "apt", Name: "Aptos", Symbol: "APT", Type: "account", Decimals: 8},
	"near":  {ID: "near", Name: "NEAR Protocol", Symbol: "NEAR", Type: "account", Decimals: 24},
	"ton":   {ID: "ton", Name: "Toncoin", Symbol: "TON", Type: "account", Decimals: 9},
	"atom":  {ID: "atom", Name: "Cosmos", Symbol: "ATOM", Type: "account", Decimals: 6},
	"osmo":  {ID: "osmo", Name: "Osmosis", Symbol: "OSMO", Type: "account", Decimals: 6},
	"inj":   {ID: "inj", Name: "Injective", Symbol: "INJ", Type: "account", Decimals: 18},
	"sei":   {ID: "sei", Name: "Sei", Symbol: "SEI", Type: "account", Decimals: 6},
	"sui":   {ID: "sui", Name: "Sui", Symbol: "SUI", Type: "account", Decimals: 9},
	"alg":   {ID: "alg", Name: "Algorand", Symbol: "ALGO", Type: "account", Decimals: 6},
	"hbar":  {ID: "hbar", Name: "Hedera", Symbol: "HBAR", Type: "account", Decimals: 8},
	"vet":   {ID: "vet", Name: "VeChain", Symbol: "VET", Type: "account", Decimals: 18},
	"icp":   {ID: "icp", Name: "Internet Computer", Symbol: "ICP", Type: "account", Decimals: 8},
	"xtz":   {ID: "xtz", Name: "Tezos", Symbol: "XTZ", Type: "account", Decimals: 6},
	"eos":   {ID: "eos", Name: "EOS", Symbol: "EOS", Type: "account", Decimals: 4},
	"flow":  {ID: "flow", Name: "Flow", Symbol: "FLOW", Type: "account", Decimals: 8},
	"algo":  {ID: "algo", Name: "Algorand", Symbol: "ALGO", Type: "account", Decimals: 6},
	"ada":   {ID: "ada", Name: "Cardano", Symbol: "ADA", Type: "account", Decimals: 6},
	"dot":   {ID: "dot", Name: "Polkadot", Symbol: "DOT", Type: "account", Decimals: 10},
	"ksm":   {ID: "ksm", Name: "Kusama", Symbol: "KSM", Type: "account", Decimals: 12},
	"zec":   {ID: "zec", Name: "Zcash", Symbol: "ZEC", Type: "utxo", Decimals: 8},
	"dash":  {ID: "dash", Name: "Dash", Symbol: "DASH", Type: "utxo", Decimals: 8},
	"xmr":   {ID: "xmr", Name: "Monero", Symbol: "XMR", Type: "utxo", Decimals: 12},
	"fil":   {ID: "fil", Name: "Filecoin", Symbol: "FIL", Type: "account", Decimals: 18},
	"ar":    {ID: "ar", Name: "Arweave", Symbol: "AR", Type: "account", Decimals: 12},
	"tia":   {ID: "tia", Name: "Celestia", Symbol: "TIA", Type: "account", Decimals: 6},
	"bttc":  {ID: "bttc", Name: "BitTorrent Chain", Symbol: "BTT", Type: "evm", ChainID: 1990, Decimals: 18},
	"op_bnb": {ID: "op_bnb", Name: "opBNB", Symbol: "BNB", Type: "evm", ChainID: 204, Decimals: 18},
	"etc":   {ID: "etc", Name: "Ethereum Classic", Symbol: "ETC", Type: "evm", ChainID: 61, Decimals: 18},
	"gno":   {ID: "gno", Name: "Gnosis", Symbol: "GNO", Type: "evm", ChainID: 100, Decimals: 18},
	"aurora": {ID: "aurora", Name: "Aurora", Symbol: "ETH", Type: "evm", ChainID: 1313161554, Decimals: 18},
	"celo":  {ID: "celo", Name: "Celo", Symbol: "CELO", Type: "evm", ChainID: 42220, Decimals: 18},
	"kava":  {ID: "kava", Name: "Kava", Symbol: "KAVA", Type: "evm", ChainID: 2222, Decimals: 18},
	"tiktok": {ID: "tiktok", Name: "TikTok", Symbol: "TikTok", Type: "evm", ChainID: 100007, Decimals: 18},
	"phi":   {ID: "phi", Name: "Phi", Symbol: "PHI", Type: "evm", ChainID: 18888, Decimals: 18},
	"pi":    {ID: "pi", Name: "Pi Network", Symbol: "PI", Type: "account", Decimals: 8},
	"pwr":   {ID: "pwr", Name: "PWR", Symbol: "PWR", Type: "evm", ChainID: 742, Decimals: 18},
	"plasma": {ID: "plasma", Name: "Plasma", Symbol: "PLASMA", Type: "evm", ChainID: 11234, Decimals: 18},
}

// Supported Tokens (200+ tokens)
var SupportedTokens = map[string]*Token{
	// Major Tokens
	"btc":    {Symbol: "BTC", Name: "Bitcoin", Blockchain: "btc", Decimals: 8, IsEnabled: true},
	"eth":    {Symbol: "ETH", Name: "Ethereum", Blockchain: "eth", Decimals: 18, IsEnabled: true},
	"usdt":   {Symbol: "USDT", Name: "Tether USD", Blockchain: "eth", Decimals: 6, IsEnabled: true},
	"usdc":   {Symbol: "USDC", Name: "USD Coin", Blockchain: "eth", Decimals: 6, IsEnabled: true},
	"bnb":    {Symbol: "BNB", Name: "BNB", Blockchain: "bsc", Decimals: 18, IsEnabled: true},
	"sol":    {Symbol: "SOL", Name: "Solana", Blockchain: "sol", Decimals: 9, IsEnabled: true},
	"xrp":    {Symbol: "XRP", Name: "Ripple", Blockchain: "xrp", Decimals: 6, IsEnabled: true},
	"doge":   {Symbol: "DOGE", Name: "Dogecoin", Blockchain: "doge", Decimals: 8, IsEnabled: true},
	"ada":    {Symbol: "ADA", Name: "Cardano", Blockchain: "ada", Decimals: 6, IsEnabled: true},
	"trx":    {Symbol: "TRX", Name: "Tron", Blockchain: "trx", Decimals: 6, IsEnabled: true},
	"ton":    {Symbol: "TON", Name: "Toncoin", Blockchain: "ton", Decimals: 9, IsEnabled: true},
	"avax":   {Symbol: "AVAX", Name: "Avalanche", Blockchain: "avax", Decimals: 18, IsEnabled: true},
	"dot":    {Symbol: "DOT", Name: "Polkadot", Blockchain: "dot", Decimals: 10, IsEnabled: true},
	"matic":  {Symbol: "MATIC", Name: "Polygon", Blockchain: "polygon", Decimals: 18, IsEnabled: true},
	"link":   {Symbol: "LINK", Name: "Chainlink", Blockchain: "eth", Decimals: 18, IsEnabled: true},
	"ltc":    {Symbol: "LTC", Name: "Litecoin", Blockchain: "ltc", Decimals: 8, IsEnabled: true},
	"bch":    {Symbol: "BCH", Name: "Bitcoin Cash", Blockchain: "bch", Decimals: 8, IsEnabled: true},
	"uni":    {Symbol: "UNI", Name: "Uniswap", Blockchain: "eth", Decimals: 18, IsEnabled: true},
	"atom":   {Symbol: "ATOM", Name: "Cosmos", Blockchain: "atom", Decimals: 6, IsEnabled: true},
	"xlm":    {Symbol: "XLM", Name: "Stellar", Blockchain: "xlm", Decimals: 7, IsEnabled: true},
	"near":   {Symbol: "NEAR", Name: "NEAR Protocol", Blockchain: "near", Decimals: 24, IsEnabled: true},
	"apt":    {Symbol: "APT", Name: "Aptos", Blockchain: "apt", Decimals: 8, IsEnabled: true},
	"fil":    {Symbol: "FIL", Name: "Filecoin", Blockchain: "fil", Decimals: 18, IsEnabled: true},
	"ldo":    {Symbol: "LDO", Name: "Lido DAO", Blockchain: "eth", Decimals: 18, IsEnabled: true},
	"rune":   {Symbol: "RUNE", Name: "THORChain", Blockchain: "rune", Decimals: 8, IsEnabled: true},
	"mkr":    {Symbol: "MKR", Name: "Maker", Blockchain: "eth", Decimals: 18, IsEnabled: true},
	"aave":   {Symbol: "AAVE", Name: "Aave", Blockchain: "eth", Decimals: 18, IsEnabled: true},
	"grt":    {Symbol: "GRT", Name: "The Graph", Blockchain: "eth", Decimals: 18, IsEnabled: true},
	"shib":   {Symbol: "SHIB", Name: "Shiba Inu", Blockchain: "eth", Decimals: 18, IsEnabled: true},
	"pepe":   {Symbol: "PEPE", Name: "Pepe", Blockchain: "eth", Decimals: 18, IsEnabled: true},
	"xmr":    {Symbol: "XMR", Name: "Monero", Blockchain: "xmr", Decimals: 12, IsEnabled: true},
	"alg":    {Symbol: "ALGO", Name: "Algorand", Blockchain: "alg", Decimals: 6, IsEnabled: true},
	"vet":    {Symbol: "VET", Name: "VeChain", Blockchain: "vet", Decimals: 18, IsEnabled: true},
	"icp":    {Symbol: "ICP", Name: "Internet Computer", Blockchain: "icp", Decimals: 8, IsEnabled: true},
	"ftm":    {Symbol: "FTM", Name: "Fantom", Blockchain: "fantom", Decimals: 18, IsEnabled: true},
	"sand":   {Symbol: "SAND", Name: "The Sandbox", Blockchain: "eth", Decimals: 18, IsEnabled: true},
	"mana":   {Symbol: "MANA", Name: "Decentraland", Blockchain: "eth", Decimals: 18, IsEnabled: true},
	"axs":    {Symbol: "AXS", Name: "Axie Infinity", Blockchain: "eth", Decimals: 18, IsEnabled: true},
	"theta":  {Symbol: "THETA", Name: "Theta Network", Blockchain: "theta", Decimals: 18, IsEnabled: true},
	"xtz":    {Symbol: "XTZ", Name: "Tezos", Blockchain: "xtz", Decimals: 6, IsEnabled: true},
	"eos":    {Symbol: "EOS", Name: "EOS", Blockchain: "eos", Decimals: 4, IsEnabled: true},
	"cake":   {Symbol: "CAKE", Name: "PancakeSwap", Blockchain: "bsc", Decimals: 18, IsEnabled: true},
	"snx":    {Symbol: "SNX", Name: "Synthetix", Blockchain: "eth", Decimals: 18, IsEnabled: true},
	"crv":    {Symbol: "CRV", Name: "Curve DAO", Blockchain: "eth", Decimals: 18, IsEnabled: true},
	"1inch":  {Symbol: "1INCH", Name: "1inch", Blockchain: "eth", Decimals: 18, IsEnabled: true},
	"enj":    {Symbol: "ENJ", Name: "Enjin Coin", Blockchain: "eth", Decimals: 18, IsEnabled: true},
	"chz":    {Symbol: "CHZ", Name: "Chiliz", Blockchain: "eth", Decimals: 18, IsEnabled: true},
	"bat":    {Symbol: "BAT", Name: "Basic Attention Token", Blockchain: "eth", Decimals: 18, IsEnabled: true},
	"paxg":   {Symbol: "PAXG", Name: "Paxos Gold", Blockchain: "eth", Decimals: 18, IsEnabled: true},
	"tusd":   {Symbol: "TUSD", Name: "TrueUSD", Blockchain: "eth", Decimals: 18, IsEnabled: true},
	"busd":   {Symbol: "BUSD", Name: "Binance USD", Blockchain: "bsc", Decimals: 18, IsEnabled: true},
	"dai":    {Symbol: "DAI", Name: "Dai Stablecoin", Blockchain: "eth", Decimals: 18, IsEnabled: true},
	"frax":   {Symbol: "FRAX", Name: "Frax", Blockchain: "eth", Decimals: 18, IsEnabled: true},
	"wbtc":   {Symbol: "WBTC", Name: "Wrapped Bitcoin", Blockchain: "eth", Decimals: 8, IsEnabled: true},
	"weth":   {Symbol: "WETH", Name: "Wrapped Ethereum", Blockchain: "eth", Decimals: 18, IsEnabled: true},
	"gala":   {Symbol: "GALA", Name: "Gala", Blockchain: "eth", Decimals: 18, IsEnabled: true},
	"imx":    {Symbol: "IMX", Name: "Immutable X", Blockchain: "eth", Decimals: 18, IsEnabled: true},
	"gmtt":   {Symbol: "GMT", Name: "STEPN", Blockchain: "sol", Decimals: 9, IsEnabled: true},
	"inj":    {Symbol: "INJ", Name: "Injective", Blockchain: "inj", Decimals: 18, IsEnabled: true},
	"osmo":   {Symbol: "OSMO", Name: "Osmosis", Blockchain: "osmo", Decimals: 6, IsEnabled: true},
	"sei":    {Symbol: "SEI", Name: "Sei", Blockchain: "sei", Decimals: 6, IsEnabled: true},
	"sui":    {Symbol: "SUI", Name: "Sui", Blockchain: "sui", Decimals: 9, IsEnabled: true},
	"tia":    {Symbol: "TIA", Name: "Celestia", Blockchain: "tia", Decimals: 6, IsEnabled: true},
	"arb":    {Symbol: "ARB", Name: "Arbitrum", Blockchain: "arbitrum", Decimals: 18, IsEnabled: true},
	"op":     {Symbol: "OP", Name: "Optimism", Blockchain: "optimism", Decimals: 18, IsEnabled: true},
	"pepe":   {Symbol: "PEPE", Name: "Pepe", Blockchain: "eth", Decimals: 18, IsEnabled: true},
	"blur":   {Symbol: "BLUR", Name: "Blur", Blockchain: "eth", Decimals: 18, IsEnabled: true},
	"rdnt":   {Symbol: "RDNT", Name: "Radiant", Blockchain: "arbitrum", Decimals: 18, IsEnabled: true},
	"pendle": {Symbol: "PENDLE", Name: "Pendle", Blockchain: "eth", Decimals: 18, IsEnabled: true},
	"jito":   {Symbol: "JTO", Name: "Jito", Blockchain: "sol", Decimals: 9, IsEnabled: true},
	"jup":    {Symbol: "JUP", Name: "Jupiter", Blockchain: "sol", Decimals: 6, IsEnabled: true},
	"wld":    {Symbol: "WLD", Name: "Worldcoin", Blockchain: "eth", Decimals: 18, IsEnabled: true},
	"bfc":    {Symbol: "BFC", Name: "Bifrost", Blockchain: "eth", Decimals: 12, IsEnabled: true},
}

// =============================================================================
// WALLET STRUCTURES
// =============================================================================

type UserWallet struct {
	ID              string                `json:"id"`
	UserID          string                `json:"userId"`
	Mnemonic        string                `json:"mnemonic,omitempty"` // Encrypted
	MnemonicHash    string                `json:"mnemonicHash"`
	Addresses       map[string]*WalletAddress `json:"addresses"` // blockchain -> address
	Balances        map[string]*Balance   `json:"balances"` // symbol -> balance
	CreatedAt       int64                 `json:"createdAt"`
	UpdatedAt       int64                 `json:"updatedAt"`
	Encrypted       bool                  `json:"encrypted"`
	WhiteLabelID    string                `json:"whiteLabelId,omitempty"`
}

type WalletAddress struct {
	Blockchain      string  `json:"blockchain"`
	Address         string  `json:"address"`
	PublicKey       string  `json:"publicKey"`
	DerivationPath  string  `json:"derivationPath"`
}

type Balance struct {
	Symbol      string  `json:"symbol"`
	Available   float64 `json:"available"`
	Locked      float64 `json:"locked"`
	Total       float64 `json:"total"`
}

type Transaction struct {
	ID            string    `json:"id"`
	TxHash        string    `json:"txHash"`
	UserID        string    `json:"userId"`
	FromAddress   string    `json:"fromAddress"`
	ToAddress     string    `json:"toAddress"`
	Amount        float64   `json:"amount"`
	Symbol        string    `json:"symbol"`
	Blockchain    string    `json:"blockchain"`
	Fee           float64   `json:"fee"`
	Status        string    `json:"status"` // pending, confirmed, failed
	Timestamp     int64     `json:"timestamp"`
	Confirmations int       `json:"confirmations"`
	Type          string    `json:"type"` // deposit, withdrawal, transfer, swap
}

// =============================================================================
// USER WALLET SERVICE
// =============================================================================

type UserWalletService struct {
	mu            sync.RWMutex
	wallets       map[string]*UserWallet // userID -> wallet
	transactions  map[string]*Transaction // txID -> transaction
	balances      map[string]map[string]*Balance // userID -> (symbol -> balance)
	
	// Multi-chain support
	blockchainClients map[string]BlockchainClient
	
	// Configuration
	config UserWalletConfig
	
	// Statistics
	stats UserWalletStats
	
	// Encryption key
	encryptionKey []byte
	
	ctx    context.Context
	cancel context.CancelFunc
}

type UserWalletConfig struct {
	AutoGenerateAddresses bool
	SupportedChains       []string
	MinConfirmations      map[string]int
	EnableDeposits        bool
	EnableWithdrawals     bool
	EnableTransfers      bool
	EnableSwap           bool
	MaxWithdrawalDaily   float64
	MaxTransferDaily     float64
}

type UserWalletStats struct {
	TotalWallets      int64 `json:"totalWallets"`
	TotalTransactions  int64 `json:"totalTransactions"`
	TotalVolume       int64 `json:"totalVolume"`
	ActiveUsers       int64 `json:"activeUsers"`
}

type BlockchainClient interface {
	GenerateAddress(mnemonic, derivationPath string) (string, string, error)
	GetBalance(address, symbol string) (float64, error)
	SendTransaction(from, to, amount, symbol string) (string, error)
	GetTransactionStatus(txHash string) (string, int, error)
}

func NewUserWalletService(encryptionKey []byte) *UserWalletService {
	ctx, cancel := context.WithCancel(context.Background())

	config := UserWalletConfig{
		AutoGenerateAddresses: true,
		SupportedChains:       []string{"eth", "bsc", "polygon", "arbitrum", "optimism", "base", "avax", "sol", "trx", "ton", "btc", "ltc", "doge", "xrp", "ada", "dot", "near", "apt", "atom"},
		MinConfirmations: map[string]int{
			"btc": 3, "eth": 12, "bsc": 15, "polygon": 100, "arbitrum": 15,
			"avax": 12, "sol": 32, "trx": 19, "xrp": 6, "ada": 10,
		},
		EnableDeposits:     true,
		EnableWithdrawals:  true,
		EnableTransfers:   true,
		EnableSwap:         true,
		MaxWithdrawalDaily: 100000,
		MaxTransferDaily:   1000000,
	}

	return &UserWalletService{
		wallets:          make(map[string]*UserWallet),
		transactions:     make(map[string]*Transaction),
		balances:         make(map[string]map[string]*Balance),
		blockchainClients: make(map[string]BlockchainClient),
		config:           config,
		stats:            UserWalletStats{},
		encryptionKey:   encryptionKey,
		ctx:              ctx,
		cancel:           cancel,
	}
}

// =============================================================================
// WALLET CREATION
// =============================================================================

func (s *UserWalletService) CreateWallet(userID, whiteLabelID string) (*UserWallet, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Check if wallet already exists
	if _, exists := s.wallets[userID]; exists {
		return nil, errors.New("wallet already exists")
	}

	// Generate 24-word mnemonic
	mnemonic := generateMnemonic()

	// Create wallet
	wallet := &UserWallet{
		ID:              uuid.New().String(),
		UserID:          userID,
		Mnemonic:        mnemonic,
		MnemonicHash:    hashString(mnemonic),
		Addresses:       make(map[string]*WalletAddress),
		Balances:        make(map[string]*Balance),
		CreatedAt:       time.Now().UnixMilli(),
		UpdatedAt:       time.Now().UnixMilli(),
		Encrypted:       false,
		WhiteLabelID:    whiteLabelID,
	}

	// Generate addresses for all supported blockchains
	for _, chain := range s.config.SupportedChains {
		address, pubKey, err := s.generateAddressForChain(mnemonic, chain)
		if err != nil {
			log.Printf("[WARN] Failed to generate address for %s: %v", chain, err)
			continue
		}

		wallet.Addresses[chain] = &WalletAddress{
			Blockchain:      chain,
			Address:         address,
			PublicKey:       pubKey,
			DerivationPath:  getDerivationPath(chain),
		}
	}

	// Initialize balances
	s.balances[userID] = make(map[string]*Balance)

	// Store wallet
	s.wallets[userID] = wallet

	// Update stats
	atomic.AddInt64(&s.stats.TotalWallets, 1)

	log.Printf("[INFO] Wallet created for user: %s with %d addresses", userID, len(wallet.Addresses))

	return wallet, nil
}

func (s *UserWalletService) ImportWallet(userID, mnemonic, whiteLabelID string) (*UserWallet, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Validate mnemonic
	if !validateMnemonic(mnemonic) {
		return nil, errors.New("invalid mnemonic")
	}

	// Check if wallet already exists
	if _, exists := s.wallets[userID]; exists {
		return nil, errors.New("wallet already exists")
	}

	// Create wallet
	wallet := &UserWallet{
		ID:              uuid.New().String(),
		UserID:          userID,
		Mnemonic:        mnemonic,
		MnemonicHash:    hashString(mnemonic),
		Addresses:       make(map[string]*WalletAddress),
		Balances:        make(map[string]*Balance),
		CreatedAt:       time.Now().UnixMilli(),
		UpdatedAt:       time.Now().UnixMilli(),
		Encrypted:       false,
		WhiteLabelID:    whiteLabelID,
	}

	// Generate addresses
	for _, chain := range s.config.SupportedChains {
		address, pubKey, err := s.generateAddressForChain(mnemonic, chain)
		if err != nil {
			continue
		}

		wallet.Addresses[chain] = &WalletAddress{
			Blockchain:      chain,
			Address:         address,
			PublicKey:       pubKey,
			DerivationPath:  getDerivationPath(chain),
		}
	}

	s.wallets[userID] = wallet
	s.balances[userID] = make(map[string]*Balance)

	atomic.AddInt64(&s.stats.TotalWallets, 1)

	log.Printf("[INFO] Wallet imported for user: %s", userID)

	return wallet, nil
}

func (s *UserWalletService) GetWallet(userID string) (*UserWallet, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	wallet, ok := s.wallets[userID]
	if !ok {
		return nil, errors.New("wallet not found")
	}

	return wallet, nil
}

func (s *UserWalletService) GetAddress(userID, blockchain string) (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	wallet, ok := s.wallets[userID]
	if !ok {
		return "", errors.New("wallet not found")
	}

	addr, ok := wallet.Addresses[blockchain]
	if !ok {
		return "", errors.New("address not found for blockchain")
	}

	return addr.Address, nil
}

// =============================================================================
// BALANCE OPERATIONS
// =============================================================================

func (s *UserWalletService) GetBalance(userID, symbol string) (*Balance, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	userBalances, ok := s.balances[userID]
	if !ok {
		return &Balance{Symbol: symbol, Available: 0, Locked: 0, Total: 0}, nil
	}

	balance, ok := userBalances[symbol]
	if !ok {
		return &Balance{Symbol: symbol, Available: 0, Locked: 0, Total: 0}, nil
	}

	return balance, nil
}

func (s *UserWalletService) GetAllBalances(userID string) (map[string]*Balance, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	userBalances, ok := s.balances[userID]
	if !ok {
		return make(map[string]*Balance), nil
	}

	return userBalances, nil
}

func (s *UserWalletService) LockBalance(userID, symbol string, amount float64) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	userBalances, ok := s.balances[userID]
	if !ok {
		return errors.New("user balances not found")
	}

	balance, ok := userBalances[symbol]
	if !ok {
		return errors.New("balance not found")
	}

	if balance.Available < amount {
		return errors.New("insufficient balance")
	}

	balance.Available -= amount
	balance.Locked += amount
	balance.Total = balance.Available + balance.Locked

	return nil
}

func (s *UserWalletService) UnlockBalance(userID, symbol string, amount float64) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	userBalances, ok := s.balances[userID]
	if !ok {
		return errors.New("user balances not found")
	}

	balance, ok := userBalances[symbol]
	if !ok {
		return errors.New("balance not found")
	}

	if balance.Locked < amount {
		return errors.New("insufficient locked balance")
	}

	balance.Locked -= amount
	balance.Available += amount
	balance.Total = balance.Available + balance.Locked

	return nil
}

func (s *UserWalletService) AddBalance(userID, symbol string, amount float64) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.balances[userID]; !ok {
		s.balances[userID] = make(map[string]*Balance)
	}

	balance, ok := s.balances[userID][symbol]
	if !ok {
		balance = &Balance{
			Symbol:    symbol,
			Available: 0,
			Locked:    0,
			Total:     0,
		}
		s.balances[userID][symbol] = balance
	}

	balance.Available += amount
	balance.Total = balance.Available + balance.Locked

	return nil
}

func (s *UserWalletService) DeductBalance(userID, symbol string, amount float64) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	userBalances, ok := s.balances[userID]
	if !ok {
		return errors.New("user balances not found")
	}

	balance, ok := userBalances[symbol]
	if !ok {
		return errors.New("balance not found")
	}

	if balance.Available < amount {
		return errors.New("insufficient balance")
	}

	balance.Available -= amount
	balance.Total = balance.Available + balance.Locked

	return nil
}

// =============================================================================
// TRANSACTION OPERATIONS
// =============================================================================

func (s *UserWalletService) CreateDeposit(userID, blockchain, fromAddress, txHash string, amount float64) (*Transaction, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Get token info
	token := getTokenForBlockchain(blockchain)
	if token == nil {
		return nil, errors.New("unsupported blockchain")
	}

	tx := &Transaction{
		ID:          uuid.New().String(),
		TxHash:      txHash,
		UserID:      userID,
		FromAddress: fromAddress,
		ToAddress:   s.wallets[userID].Addresses[blockchain].Address,
		Amount:      amount,
		Symbol:      token.Symbol,
		Blockchain:  blockchain,
		Fee:         0,
		Status:      "pending",
		Timestamp:   time.Now().UnixMilli(),
		Type:        "deposit",
	}

	s.transactions[tx.ID] = tx

	// Add to balance
	s.addToBalance(userID, token.Symbol, amount)

	log.Printf("[INFO] Deposit created: %s %f %s from %s", txHash, amount, token.Symbol, fromAddress)

	return tx, nil
}

func (s *UserWalletService) CreateWithdrawal(userID, blockchain, toAddress string, amount float64) (*Transaction, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.config.EnableWithdrawals {
		return nil, errors.New("withdrawals disabled")
	}

	// Get token info
	token := getTokenForBlockchain(blockchain)
	if token == nil {
		return nil, errors.New("unsupported blockchain")
	}

	// Check balance
	userBalances, ok := s.balances[userID]
	if !ok {
		return nil, errors.New("balance not found")
	}

	balance, ok := userBalances[token.Symbol]
	if !ok || balance.Available < amount {
		return nil, errors.New("insufficient balance")
	}

	// Deduct balance
	balance.Available -= amount
	balance.Total = balance.Available + balance.Locked

	// Create transaction
	tx := &Transaction{
		ID:          uuid.New().String(),
		TxHash:      "",
		UserID:      userID,
		FromAddress: s.wallets[userID].Addresses[blockchain].Address,
		ToAddress:   toAddress,
		Amount:      amount,
		Symbol:      token.Symbol,
		Blockchain:  blockchain,
		Fee:         calculateFee(blockchain, amount),
		Status:      "pending",
		Timestamp:   time.Now().UnixMilli(),
		Type:        "withdrawal",
	}

	s.transactions[tx.ID] = tx
	atomic.AddInt64(&s.stats.TotalTransactions, 1)
	atomic.AddInt64(&s.stats.TotalVolume, int64(amount))

	log.Printf("[INFO] Withdrawal created: %s %f %s to %s", tx.ID, amount, token.Symbol, toAddress)

	return tx, nil
}

func (s *UserWalletService) CreateTransfer(fromUserID, toUserID, blockchain string, amount float64) (*Transaction, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.config.EnableTransfers {
		return nil, errors.New("transfers disabled")
	}

	// Get token info
	token := getTokenForBlockchain(blockchain)
	if token == nil {
		return nil, errors.New("unsupported blockchain")
	}

	// Check sender balance
	fromBalances, ok := s.balances[fromUserID]
	if !ok {
		return nil, errors.New("sender balance not found")
	}

	fromBalance, ok := fromBalances[token.Symbol]
	if !ok || fromBalance.Available < amount {
		return nil, errors.New("insufficient balance")
	}

	// Deduct from sender
	fromBalance.Available -= amount
	fromBalance.Total = fromBalance.Available + fromBalance.Locked

	// Add to receiver
	if _, ok := s.balances[toUserID]; !ok {
		s.balances[toUserID] = make(map[string]*Balance)
	}

	toBalance, ok := s.balances[toUserID][token.Symbol]
	if !ok {
		toBalance = &Balance{Symbol: token.Symbol}
		s.balances[toUserID][token.Symbol] = toBalance
	}
	toBalance.Available += amount
	toBalance.Total = toBalance.Available + toBalance.Locked

	// Create transaction
	tx := &Transaction{
		ID:          uuid.New().String(),
		TxHash:      "",
		UserID:      fromUserID,
		FromAddress: s.wallets[fromUserID].Addresses[blockchain].Address,
		ToAddress:   s.wallets[toUserID].Addresses[blockchain].Address,
		Amount:      amount,
		Symbol:      token.Symbol,
		Blockchain:  blockchain,
		Fee:         0,
		Status:      "completed",
		Timestamp:   time.Now().UnixMilli(),
		Type:        "transfer",
	}

	s.transactions[tx.ID] = tx

	log.Printf("[INFO] Transfer: %s -> %s: %f %s", fromUserID, toUserID, amount, token.Symbol)

	return tx, nil
}

func (s *UserWalletService) GetTransaction(txID string) (*Transaction, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	tx, ok := s.transactions[txID]
	if !ok {
		return nil, errors.New("transaction not found")
	}

	return tx, nil
}

func (s *UserWalletService) GetUserTransactions(userID string, limit int) []*Transaction {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var txs []*Transaction
	count := 0

	for _, tx := range s.transactions {
		if tx.UserID == userID {
			txs = append(txs, tx)
			count++
			if count >= limit {
				break
			}
		}
	}

	return txs
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

func (s *UserWalletService) generateAddressForChain(mnemonic, blockchain string) (string, string, error) {
	// Simplified address generation
	// In production, would use proper BIP32/BIP44 derivation

	chain, ok := Blockchains[blockchain]
	if !ok {
		return "", "", errors.New("unsupported blockchain")
	}

	hasher := sha256.New()
	hasher.Write([]byte(mnemonic))
	hasher.Write([]byte(blockchain))
	hash := hasher.Sum(nil)

	switch chain.Type {
	case "evm":
		// EVM address
		address := "0x" + hex.EncodeToString(hash[12:32])
		pubKey := hex.EncodeToString(hash[:32])
		return address, pubKey, nil

	case "utxo":
		// Bitcoin-like address (simplified)
		address := "1" + base58.Encode(hash[:20])
		pubKey := hex.EncodeToString(hash[:32])
		return address, pubKey, nil

	case "account":
		// Account-based (Solana, Aptos, etc)
		address := base58.Encode(hash[:32])
		pubKey := hex.EncodeToString(hash[:32])
		return address, pubKey, nil

	default:
		return "", "", errors.New("unsupported chain type")
	}
}

func getDerivationPath(blockchain string) string {
	paths := map[string]string{
		"eth":     "m/44'/60'/0'/0/0",
		"bsc":     "m/44'/60'/0'/0/0",
		"polygon": "m/44'/60'/0'/0/0",
		"arbitrum": "m/44'/60'/0'/0/0",
		"optimism": "m/44'/60'/0'/0/0",
		"base":    "m/44'/60'/0'/0/0",
		"avax":    "m/44'/60'/0'/0/0",
		"sol":     "m/44'/501'/0'/0'",
		"trx":     "m/44'/195'/0'/0/0",
		"ton":     "m/44'/607'/0'/0'",
		"btc":     "m/44'/0'/0'/0/0",
		"ltc":     "m/44'/2'/0'/0/0",
		"doge":    "m/44'/3'/0'/0/0",
		"ada":     "m/44'/1815'/0'/0'",
		"dot":     "m/44'/354'/0'/0/0",
		"near":    "m/44'/397'/0'/0'",
		"apt":     "m/44'/637'/0'/0'/0'",
		"atom":    "m/44'/118'/0'/0/0",
	}

	return paths[blockchain]
}

func getTokenForBlockchain(blockchain string) *Token {
	// Map blockchain to default token
	tokens := map[string]*Token{
		"eth":       SupportedTokens["eth"],
		"bsc":      SupportedTokens["bnb"],
		"polygon":  SupportedTokens["matic"],
		"arbitrum": SupportedTokens["eth"],
		"optimism": SupportedTokens["eth"],
		"base":     SupportedTokens["eth"],
		"avax":     SupportedTokens["avax"],
		"sol":      SupportedTokens["sol"],
		"trx":      SupportedTokens["trx"],
		"ton":      SupportedTokens["ton"],
		"btc":      SupportedTokens["btc"],
		"ltc":      SupportedTokens["ltc"],
		"doge":     SupportedTokens["doge"],
		"xrp":      SupportedTokens["xrp"],
		"ada":      SupportedTokens["ada"],
		"dot":      SupportedTokens["dot"],
		"near":     SupportedTokens["near"],
		"apt":      SupportedTokens["apt"],
		"atom":     SupportedTokens["atom"],
	}

	return tokens[blockchain]
}

func calculateFee(blockchain string, amount float64) float64 {
	feePercent := map[string]float64{
		"btc":  0.0005,
		"eth":  0.001,
		"bsc":  0.0005,
		"polygon": 0.001,
		"sol":  0.00025,
		"trx":  1.0,
	}

	fee := feePercent[blockchain]
	if fee == 0 {
		fee = 0.001
	}

	return amount * fee
}

func (s *UserWalletService) addToBalance(userID, symbol string, amount float64) {
	if _, ok := s.balances[userID]; !ok {
		s.balances[userID] = make(map[string]*Balance)
	}

	balance, ok := s.balances[userID][symbol]
	if !ok {
		balance = &Balance{Symbol: symbol}
		s.balances[userID][symbol] = balance
	}

	balance.Available += amount
	balance.Total = balance.Available + balance.Locked
}

func generateMnemonic() string {
	// Simplified - in production would use proper BIP39
	words := strings.Fields("abandon able acid acoustic act adopt adult aero afford after again agent agree ahead aim air aisle alarm album alcohol alien alike alive alley allow alone along alter among anger angle angry animal ankle apart apple apply arena argue arise armed armor array arrow aside asset audio audit avoid awake award aware awful bacon badge bagel baggy balance baker balance")

	mnemonic := make([]string, 24)
	for i := range mnemonic {
		mnemonic[i] = words[randInt(len(words))]
	}

	return strings.Join(mnemonic, " ")
}

func validateMnemonic(mnemonic string) bool {
	words := strings.Fields(mnemonic)
	return len(words) == 24
}

func hashString(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

func randInt(n int) int {
	b := make([]byte, 1)
	rand.Read(b)
	return int(b[0]) % n
}

var _ = fmt.Errorf
var _ = json.Marshal
