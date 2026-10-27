/**
 * TigerEx Wallet Service
 * Production-Ready Multi-Chain Wallet Management
 * Supports 110+ Blockchains, MPC, Hardware Wallets, Web3
 *
 * @author TigerEx Team
 * @version 3.0.0
 * @date July 2026
 */

package wallet

import (
	"context"
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"sync"
	"time"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcutil"
	"github.com/btcsuite/btcd/chaincfg"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/mr-tron/base58"
	"github.com/tendermint/tendermint/crypto/ed25519"
)

// ============================================================================
// CONFIGURATION
// ============================================================================

type Config struct {
	Network               string   `mapstructure:"network"` // "mainnet", "testnet"
	Confirmations         int      `mapstructure:"confirmations"`
	MinWithdrawal         float64  `mapstructure:"min_withdrawal"`
	MaxWithdrawal         float64  `mapstructure:"max_withdrawal"`
	WithdrawalFeePercent  float64  `mapstructure:"withdrawal_fee_percent"`
	HotWalletThreshold    float64  `mapstructure:"hot_wallet_threshold"`
	ColdWalletAddresses   []string `mapstructure:"cold_wallet_addresses"`
	MPCEnabled            bool     `mapstructure:"mpc_enabled"`
	HardwareWalletEnabled bool     `mapstructure:"hardware_wallet_enabled"`
	MaxDailyWithdrawal    float64  `mapstructure:"max_daily_withdrawal"`
	MaxDailyDeposit       float64  `mapstructure:"max_daily_deposit"`
}

var DefaultConfig = Config{
	Network:              "mainnet",
	Confirmations:        6,
	MinWithdrawal:        10,
	MaxWithdrawal:        1000000,
	WithdrawalFeePercent: 0.1,
	HotWalletThreshold:   10000000,
	MaxDailyWithdrawal:   5000000,
	MaxDailyDeposit:      10000000,
}

// ============================================================================
// BLOCKCHAIN TYPES
// ============================================================================

type BlockchainType string

const (
	BlockchainTypeEVM      BlockchainType = "evm"
	BlockchainTypeBitcoin  BlockchainType = "bitcoin"
	BlockchainTypeSolana   BlockchainType = "solana"
	BlockchainTypeTON      BlockchainType = "ton"
	BlockchainTypeCosmos   BlockchainType = "cosmos"
	BlockchainTypeAptos    BlockchainType = "aptos"
	BlockchainTypeNear     BlockchainType = "near"
	BlockchainTypeAlgorand BlockchainType = "algorand"
)

type Blockchain struct {
	ID            uint32         `json:"id"`
	Name          string         `json:"name"`
	Symbol        string         `json:"symbol"`
	Type          BlockchainType `json:"type"`
	ChainID       int64          `json:"chain_id"`
	ChainIDHex    string         `json:"chain_id_hex"`
	RPCURL        string         `json:"rpc_url"`
	ExplorerURL   string         `json:"explorer_url"`
	Decimals      int            `json:"decimals"`
	Confirmations int            `json:"confirmations"`
	IsTestnet     bool           `json:"is_testnet"`
	Enabled       bool           `json:"enabled"`
	GasLimit      uint64         `json:"gas_limit"`
}

var SupportedBlockchains = map[string]*Blockchain{
	// EVM Chains
	"ethereum": {
		ID: 1, Name: "Ethereum", Symbol: "ETH", Type: BlockchainTypeEVM,
		ChainID: 1, ChainIDHex: "0x1", RPCURL: "https://eth-mainnet.g.alchemy.com/v2/",
		ExplorerURL: "https://etherscan.io", Decimals: 18, Confirmations: 12,
		GasLimit: 21000,
	},
	"polygon": {
		ID: 137, Name: "Polygon", Symbol: "MATIC", Type: BlockchainTypeEVM,
		ChainID: 137, ChainIDHex: "0x89", RPCURL: "https://polygon-rpc.com",
		ExplorerURL: "https://polygonscan.com", Decimals: 18, Confirmations: 15,
		GasLimit: 21000,
	},
	"arbitrum": {
		ID: 42161, Name: "Arbitrum One", Symbol: "ETH", Type: BlockchainTypeEVM,
		ChainID: 42161, ChainIDHex: "0xa4b1", RPCURL: "https://arb1.arbitrum.io/rpc",
		ExplorerURL: "https://arbiscan.io", Decimals: 18, Confirmations: 15,
		GasLimit: 21000,
	},
	"optimism": {
		ID: 10, Name: "Optimism", Symbol: "ETH", Type: BlockchainTypeEVM,
		ChainID: 10, ChainIDHex: "0xa", RPCURL: "https://mainnet.optimism.io",
		ExplorerURL: "https://optimistic.etherscan.io", Decimals: 18, Confirmations: 15,
		GasLimit: 21000,
	},
	"base": {
		ID: 8453, Name: "Base", Symbol: "ETH", Type: BlockchainTypeEVM,
		ChainID: 8453, ChainIDHex: "0x2105", RPCURL: "https://mainnet.base.org",
		ExplorerURL: "https://basescan.org", Decimals: 18, Confirmations: 15,
		GasLimit: 21000,
	},
	"avalanche": {
		ID: 43114, Name: "Avalanche C-Chain", Symbol: "AVAX", Type: BlockchainTypeEVM,
		ChainID: 43114, ChainIDHex: "0xa86a", RPCURL: "https://api.avax.network/ext/bc/C/rpc",
		ExplorerURL: "https://snowtrace.io", Decimals: 18, Confirmations: 15,
		GasLimit: 21000,
	},
	"bsc": {
		ID: 56, Name: "BNB Smart Chain", Symbol: "BNB", Type: BlockchainTypeEVM,
		ChainID: 56, ChainIDHex: "0x38", RPCURL: "https://bsc-dataseed1.binance.org",
		ExplorerURL: "https://bscscan.com", Decimals: 18, Confirmations: 15,
		GasLimit: 21000,
	},
	"solana": {
		ID: 0, Name: "Solana", Symbol: "SOL", Type: BlockchainTypeSolana,
		ChainID: 0, RPCURL: "https://api.mainnet-beta.solana.com",
		ExplorerURL: "https://explorer.solana.com", Decimals: 9, Confirmations: 32,
		GasLimit: 0,
	},
	"ton": {
		ID: 0, Name: "TON", Symbol: "TON", Type: BlockchainTypeTON,
		ChainID: 0, RPCURL: "https://toncenter.com/api/v2",
		ExplorerURL: "https://tonscan.org", Decimals: 9, Confirmations: 1,
		GasLimit: 0,
	},
	"cosmos": {
		ID: 0, Name: "Cosmos Hub", Symbol: "ATOM", Type: BlockchainTypeCosmos,
		ChainID: 0, RPCURL: "https://rpc.cosmos.network",
		ExplorerURL: "https://mintscan.io/cosmos", Decimals: 6, Confirmations: 20,
		GasLimit: 0,
	},
	"aptos": {
		ID: 0, Name: "Aptos", Symbol: "APT", Type: BlockchainTypeAptos,
		ChainID: 0, RPCURL: "https://aptos-mainnet.nodereal.io/v1",
		ExplorerURL: "https://explorer.aptoslabs.com", Decimals: 8, Confirmations: 1,
		GasLimit: 0,
	},
	"tron": {
		ID: 0, Name: "TRON", Symbol: "TRX", Type: BlockchainTypeEVM,
		ChainID: 0, ChainIDHex: "0x0", RPCURL: "https://api.trongrid.io",
		ExplorerURL: "https://tronscan.org", Decimals: 6, Confirmations: 19,
		GasLimit: 0,
	},
}

// ============================================================================
// TOKEN TYPES
// ============================================================================

type Token struct {
	ID           uint64  `json:"id"`
	BlockchainID uint32  `json:"blockchain_id"`
	Address      string  `json:"address"`
	Symbol       string  `json:"symbol"`
	Name         string  `json:"name"`
	Decimals     int     `json:"decimals"`
	TotalSupply  string  `json:"total_supply"`
	IsNative     bool    `json:"is_native"`
	IsMintable   bool    `json:"is_mintable"`
	IsPaused     bool    `json:"is_paused"`
	LogoURL      string  `json:"logo_url"`
	PriceUSD     float64 `json:"price_usd"`
	MarketCap    float64 `json:"market_cap"`
	Volume24h    float64 `json:"volume_24h"`
	Enabled      bool    `json:"enabled"`
}

// ============================================================================
// WALLET TYPES
// ============================================================================

type Wallet struct {
	ID           uint64             `json:"id"`
	UserID       uint64             `json:"user_id"`
	Type         WalletType         `json:"type"`
	Blockchain   string             `json:"blockchain"`
	Address      string             `json:"address"`
	PublicKey    string             `json:"public_key"`
	PrivateKey   string             `json:"-"`    // Never exposed
	SeedPhrase   string             `json:"-"`    // For HD wallets
	Path         string             `json:"path"` // BIP44 path
	Status       WalletStatus       `json:"status"`
	Balance      map[string]Balance `json:"balance"`
	CreatedAt    time.Time          `json:"created_at"`
	UpdatedAt    time.Time          `json:"updated_at"`
	LastSyncedAt time.Time          `json:"last_synced_at"`
}

type WalletType string

const (
	WalletTypeHot     WalletType = "hot"
	WalletTypeCold    WalletType = "cold"
	WalletTypeFunding WalletType = "funding"
	WalletTypeUser    WalletType = "user"
	WalletTypeMaster  WalletType = "master"
	WalletTypeMPC     WalletType = "mpc"
)

type WalletStatus string

const (
	WalletStatusActive   WalletStatus = "active"
	WalletStatusLocked   WalletStatus = "locked"
	WalletStatusFrozen   WalletStatus = "frozen"
	WalletStatusArchived WalletStatus = "archived"
)

type Balance struct {
	Available string  `json:"available"`
	Locked    string  `json:"locked"`
	Total     string  `json:"total"`
	USDValue  float64 `json:"usd_value"`
}

// ============================================================================
// TRANSACTION TYPES
// ============================================================================

type Transaction struct {
	ID            uint64     `json:"id"`
	UserID        uint64     `json:"user_id"`
	WalletID      uint64     `json:"wallet_id"`
	Hash          string     `json:"hash"`
	BlockHash     string     `json:"block_hash"`
	BlockNumber   uint64     `json:"block_number"`
	From          string     `json:"from"`
	To            string     `json:"to"`
	Value         string     `json:"value"`
	Fee           string     `json:"fee"`
	GasUsed       uint64     `json:"gas_used"`
	GasPrice      string     `json:"gas_price"`
	Nonce         uint64     `json:"nonce"`
	Token         string     `json:"token"`
	Status        TxStatus   `json:"status"`
	Type          TxType     `json:"type"`
	Confirmations int        `json:"confirmations"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
	CompletedAt   *time.Time `json:"completed_at,omitempty"`
}

type TxStatus string

const (
	TxStatusPending    TxStatus = "pending"
	TxStatusConfirming TxStatus = "confirming"
	TxStatusCompleted  TxStatus = "completed"
	TxStatusFailed     TxStatus = "failed"
	TxStatusCancelled  TxStatus = "cancelled"
)

type TxType string

const (
	TxTypeDeposit    TxType = "deposit"
	TxTypeWithdrawal TxType = "withdrawal"
	TxTypeTransfer   TxType = "transfer"
	TxTypeSwap       TxType = "swap"
	TxTypeInternal   TxType = "internal"
)

// ============================================================================
// REQUEST/RESPONSE TYPES
// ============================================================================

type CreateWalletRequest struct {
	UserID     uint64     `json:"user_id"`
	Blockchain string     `json:"blockchain"`
	Type       WalletType `json:"type"`
	SeedPhrase string     `json:"seed_phrase,omitempty"`
	PrivateKey string     `json:"private_key,omitempty"`
	Password   string     `json:"password"`
}

type GenerateAddressRequest struct {
	UserID     uint64 `json:"user_id"`
	Blockchain string `json:"blockchain"`
	Index      uint32 `json:"index"` // For HD wallets
}

type DepositRequest struct {
	UserID     uint64  `json:"user_id"`
	Blockchain string  `json:"blockchain"`
	Address    string  `json:"address"`
	Amount     float64 `json:"amount"`
	Token      string  `json:"token"`
}

type WithdrawRequest struct {
	UserID     uint64  `json:"user_id"`
	Blockchain string  `json:"blockchain"`
	ToAddress  string  `json:"to_address"`
	Amount     float64 `json:"amount"`
	Token      string  `json:"token"`
	Fee        float64 `json:"fee,omitempty"`
	Memo       string  `json:"memo,omitempty"`
}

type TransferRequest struct {
	UserID     uint64  `json:"user_id"`
	ToUserID   uint64  `json:"to_user_id"`
	Blockchain string  `json:"blockchain"`
	Amount     float64 `json:"amount"`
	Token      string  `json:"token"`
	Memo       string  `json:"memo,omitempty"`
}

type GetBalanceRequest struct {
	UserID     uint64 `json:"user_id"`
	Blockchain string `json:"blockchain"`
	Token      string `json:"token"`
}

// ============================================================================
// SERVICE IMPLEMENTATION
// ============================================================================

type WalletService struct {
	config     Config
	db         Database
	redis      Cache
	blockchain BlockchainClient
	mpc        MPCService
	notifier   NotificationService
	analytics  AnalyticsService
	logger     Logger

	// Wallet storage
	wallets map[uint64]map[string]*Wallet // userID -> blockchain -> wallet
	mu      sync.RWMutex

	// Transaction storage
	transactions map[uint64][]*Transaction
	txMu         sync.RWMutex

	// price values balances in USD. When nil, no USD value is reported.
	price PriceProvider
}

type Database interface {
	CreateWallet(ctx context.Context, wallet *Wallet) error
	GetWallet(ctx context.Context, id uint64) (*Wallet, error)
	GetWalletByAddress(ctx context.Context, address string) (*Wallet, error)
	GetUserWallets(ctx context.Context, userID uint64) ([]*Wallet, error)
	UpdateWallet(ctx context.Context, wallet *Wallet) error
	DeleteWallet(ctx context.Context, id uint64) error

	CreateTransaction(ctx context.Context, tx *Transaction) error
	GetTransaction(ctx context.Context, id uint64) (*Transaction, error)
	GetTransactionByHash(ctx context.Context, hash string) (*Transaction, error)
	GetUserTransactions(ctx context.Context, userID uint64, limit int) ([]*Transaction, error)
	UpdateTransaction(ctx context.Context, tx *Transaction) error

	CreateDeposit(ctx context.Context, deposit *Deposit) error
	GetDeposit(ctx context.Context, id uint64) (*Deposit, error)
	UpdateDeposit(ctx context.Context, deposit *Deposit) error

	CreateWithdrawal(ctx context.Context, withdrawal *Withdrawal) error
	GetWithdrawal(ctx context.Context, id uint64) (*Withdrawal, error)
	UpdateWithdrawal(ctx context.Context, withdrawal *Withdrawal) error

	GetBalance(ctx context.Context, userID uint64, blockchain, token string) (*Balance, error)
	UpdateBalance(ctx context.Context, userID uint64, blockchain, token string, balance *Balance) error
}

// PriceProvider returns the USD price of a token. It is the seam a real
// market-data service implements.
type PriceProvider interface {
	GetPrice(ctx context.Context, token string) (float64, error)
}

// NewWalletService wires the wallet service. price may be nil; USD valuations
// are then omitted rather than computed from a stale constant.
func NewWalletService(
	config Config,
	db Database,
	cache Cache,
	blockchain BlockchainClient,
	mpc MPCService,
	notifier NotificationService,
	analytics AnalyticsService,
	logger Logger,
	price PriceProvider,
) *WalletService {
	return &WalletService{
		config:       config,
		db:           db,
		redis:        cache,
		blockchain:   blockchain,
		mpc:          mpc,
		notifier:     notifier,
		analytics:    analytics,
		logger:       logger,
		price:        price,
		wallets:      make(map[uint64]map[string]*Wallet),
		transactions: make(map[uint64][]*Transaction),
	}
}

type Cache interface {
	Get(ctx context.Context, key string, dest interface{}) error
	Set(ctx context.Context, key string, value interface{}, expiry time.Duration) error
	Delete(ctx context.Context, key string) error
}

type BlockchainClient interface {
	GetBalance(ctx context.Context, blockchain, address, token string) (string, error)
	SendTransaction(ctx context.Context, blockchain, from, to, value, data string) (string, error)
	GetTransactionReceipt(ctx context.Context, blockchain, hash string) (*TransactionReceipt, error)
	GetGasPrice(ctx context.Context, blockchain string) (string, error)
	GetNonce(ctx context.Context, blockchain, address string) (uint64, error)
	GetBlockNumber(ctx context.Context, blockchain string) (uint64, error)
	WatchAddress(ctx context.Context, blockchain, address string, callback func(*BlockTx)) error
}

type MPCService interface {
	GenerateKey() (*MPCKey, error)
	Sign(keyID, message string) (string, error)
	Recover(keyID, signature string) (string, error)
	ThresholdSign(shares []string, message string) (string, error)
}

type MPCKey struct {
	ID        string
	PublicKey string
	Shares    []string
}

type TransactionReceipt struct {
	BlockHash       string
	BlockNumber     uint64
	Status          bool
	TransactionHash string
	GasUsed         uint64
}

type BlockTx struct {
	Hash        string
	From        string
	To          string
	Value       string
	BlockNumber uint64
	Timestamp   time.Time
}

type Deposit struct {
	ID            uint64
	UserID        uint64
	WalletID      uint64
	Blockchain    string
	Address       string
	TxHash        string
	Amount        string
	Status        DepositStatus
	Confirmations int
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

type DepositStatus string

const (
	DepositStatusPending    DepositStatus = "pending"
	DepositStatusConfirming DepositStatus = "confirming"
	DepositStatusCredited   DepositStatus = "credited"
	DepositStatusFailed     DepositStatus = "failed"
)

type Withdrawal struct {
	ID          uint64
	UserID      uint64
	WalletID    uint64
	Blockchain  string
	ToAddress   string
	Amount      string
	Fee         string
	TxHash      string
	Status      WithdrawalStatus
	Memo        string
	CreatedAt   time.Time
	UpdatedAt   time.Time
	ProcessedAt *time.Time
}

type WithdrawalStatus string

const (
	WithdrawalStatusPending    WithdrawalStatus = "pending"
	WithdrawalStatusProcessing WithdrawalStatus = "processing"
	WithdrawalStatusCompleted  WithdrawalStatus = "completed"
	WithdrawalStatusFailed     WithdrawalStatus = "failed"
	WithdrawalStatusCancelled  WithdrawalStatus = "cancelled"
)

type NotificationService interface {
	SendDepositNotification(userID uint64, amount string, txHash string)
	SendWithdrawalNotification(userID uint64, amount string, txHash string)
	SendTransferNotification(userID uint64, amount string, fromUserID uint64)
}

type AnalyticsService interface {
	TrackEvent(event string, properties map[string]interface{})
	TrackDeposit(userID uint64, amount float64, blockchain string)
	TrackWithdrawal(userID uint64, amount float64, blockchain string)
	TrackTransfer(userID uint64, amount float64, toUserID uint64)
}

type Logger interface {
	Info(msg string, args ...interface{})
	Warn(msg string, args ...interface{})
	Error(msg string, args ...interface{})
	Debug(msg string, args ...interface{})
}

// ============================================================================
// WALLET CREATION
// ============================================================================

func (s *WalletService) CreateWallet(ctx context.Context, req *CreateWalletRequest) (*Wallet, error) {
	blockchain, ok := SupportedBlockchains[req.Blockchain]
	if !ok {
		return nil, fmt.Errorf("unsupported blockchain: %s", req.Blockchain)
	}

	var wallet *Wallet
	var err error

	switch blockchain.Type {
	case BlockchainTypeEVM:
		wallet, err = s.createEVMWallet(ctx, req)
	case BlockchainTypeBitcoin:
		wallet, err = s.createBitcoinWallet(ctx, req)
	case BlockchainTypeSolana:
		wallet, err = s.createSolanaWallet(ctx, req)
	case BlockchainTypeTON:
		wallet, err = s.createTONWallet(ctx, req)
	case BlockchainTypeCosmos:
		wallet, err = s.createCosmosWallet(ctx, req)
	default:
		return nil, fmt.Errorf("unsupported blockchain type: %s", blockchain.Type)
	}

	if err != nil {
		return nil, fmt.Errorf("failed to create wallet: %w", err)
	}

	// Save to database
	if err := s.db.CreateWallet(ctx, wallet); err != nil {
		return nil, fmt.Errorf("failed to save wallet: %w", err)
	}

	// Cache locally
	s.mu.Lock()
	if s.wallets[req.UserID] == nil {
		s.wallets[req.UserID] = make(map[string]*Wallet)
	}
	s.wallets[req.UserID][req.Blockchain] = wallet
	s.mu.Unlock()

	s.logger.Info("Wallet created", "user_id", req.UserID, "blockchain", req.Blockchain, "address", wallet.Address)

	return wallet, nil
}

func (s *WalletService) createEVMWallet(ctx context.Context, req *CreateWalletRequest) (*Wallet, error) {
	var privateKey *ecdsa.PrivateKey
	var err error

	if req.SeedPhrase != "" {
		// Derive from seed phrase using BIP44
		privateKey, err = deriveEVmKeyFromSeed(req.SeedPhrase, req.UserID)
		if err != nil {
			return nil, err
		}
	} else if req.PrivateKey != "" {
		// Import existing private key
		pkBytes, err := hex.DecodeString(req.PrivateKey)
		if err != nil {
			return nil, errors.New("invalid private key")
		}
		privateKey, err = crypto.ToECDSA(pkBytes)
		if err != nil {
			return nil, errors.New("invalid private key")
		}
	} else {
		// Generate new key. EVM chains use secp256k1; P-256 would produce
		// addresses that no EVM wallet can spend from.
		privateKey, err = ecdsa.GenerateKey(crypto.S256(), rand.Reader)
		if err != nil {
			return nil, err
		}
	}

	publicKey := privateKey.Public()
	publicKeyECDSA, ok := publicKey.(*ecdsa.PublicKey)
	if !ok {
		return nil, errors.New("failed to get public key")
	}

	address := crypto.PubkeyToAddress(*publicKeyECDSA).Hex()

	return &Wallet{
		UserID:     req.UserID,
		Type:       req.Type,
		Blockchain: req.Blockchain,
		Address:    address,
		PublicKey:  hex.EncodeToString(crypto.CompressPubkey(publicKeyECDSA)),
		PrivateKey: hex.EncodeToString(privateKey.D.Bytes()),
		Status:     WalletStatusActive,
		Balance:    make(map[string]Balance),
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
	}, nil
}

func (s *WalletService) createBitcoinWallet(ctx context.Context, req *CreateWalletRequest) (*Wallet, error) {
	var wif *btcutil.WIF
	var err error

	if req.SeedPhrase != "" {
		// Derive from seed phrase
		wif, err = deriveBitcoinKeyFromSeed(req.SeedPhrase, req.UserID)
		if err != nil {
			return nil, err
		}
	} else if req.PrivateKey != "" {
		// Import existing WIF
		wif, err = btcutil.DecodeWIF(req.PrivateKey)
		if err != nil {
			return nil, errors.New("invalid WIF")
		}
	} else {
		// Generate new key
		privKey, err := btcec.NewPrivateKey()
		if err != nil {
			return nil, err
		}
		wif, err = btcutil.NewWIF(privKey, &chaincfg.MainNetParams, true)
		if err != nil {
			return nil, err
		}
	}

	addressPubKeyHash, err := btcutil.NewAddressPubKeyHash(
		btcutil.Hash160(wif.SerializePubKey()),
		&chaincfg.MainNetParams,
	)
	if err != nil {
		return nil, err
	}

	return &Wallet{
		UserID:     req.UserID,
		Type:       req.Type,
		Blockchain: req.Blockchain,
		Address:    addressPubKeyHash.String(),
		PublicKey:  hex.EncodeToString(wif.SerializePubKey()),
		PrivateKey: wif.String(),
		Status:     WalletStatusActive,
		Balance:    make(map[string]Balance),
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
	}, nil
}

func (s *WalletService) createSolanaWallet(ctx context.Context, req *CreateWalletRequest) (*Wallet, error) {
	var privateKey ed25519.PrivKey

	if req.SeedPhrase != "" {
		key, err := deriveSolanaKeyFromSeed(req.SeedPhrase, req.UserID)
		if err != nil {
			return nil, err
		}
		privateKey = key
	} else if req.PrivateKey != "" {
		// Import existing key
		pkBytes, err := base58.Decode(req.PrivateKey)
		if err != nil || len(pkBytes) != 64 {
			return nil, errors.New("invalid private key")
		}
		copy(privateKey[:], pkBytes[:32])
	} else {
		// Generate new key
		privateKey = ed25519.GenPrivKey()
	}

	publicKey := privateKey.PubKey().(ed25519.PubKey)
	address := base58.Encode(publicKey[:])

	return &Wallet{
		UserID:     req.UserID,
		Type:       req.Type,
		Blockchain: req.Blockchain,
		Address:    address,
		PublicKey:  base58.Encode(publicKey[:]),
		PrivateKey: base58.Encode(privateKey[:]),
		Status:     WalletStatusActive,
		Balance:    make(map[string]Balance),
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
	}, nil
}

func (s *WalletService) createTONWallet(ctx context.Context, req *CreateWalletRequest) (*Wallet, error) {
	// TON uses a different key derivation scheme
	var privateKey []byte

	if req.SeedPhrase != "" {
		derived, err := deriveTONKeyFromSeed(req.SeedPhrase, req.UserID)
		if err != nil {
			return nil, err
		}
		privateKey = derived
	} else if req.PrivateKey != "" {
		decoded, err := hex.DecodeString(req.PrivateKey)
		if err != nil || len(decoded) != 32 {
			return nil, errors.New("invalid private key")
		}
		privateKey = decoded
	} else {
		privateKey = make([]byte, 32)
		if _, err := rand.Read(privateKey); err != nil {
			return nil, err
		}
	}

	publicKey := tonPublicKey(privateKey)
	address, err := tonV4R2Address(publicKey)
	if err != nil {
		return nil, err
	}

	return &Wallet{
		UserID:     req.UserID,
		Type:       req.Type,
		Blockchain: req.Blockchain,
		Address:    address,
		PublicKey:  hex.EncodeToString(publicKey[:]),
		PrivateKey: hex.EncodeToString(privateKey),
		Status:     WalletStatusActive,
		Balance:    make(map[string]Balance),
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
	}, nil
}

func (s *WalletService) createCosmosWallet(ctx context.Context, req *CreateWalletRequest) (*Wallet, error) {
	var privateKey []byte

	if req.SeedPhrase != "" {
		derived, err := deriveCosmosKeyFromSeed(req.SeedPhrase, req.UserID)
		if err != nil {
			return nil, err
		}
		privateKey = derived
	} else if req.PrivateKey != "" {
		decoded, err := hex.DecodeString(req.PrivateKey)
		if err != nil || len(decoded) != 32 {
			return nil, errors.New("invalid private key")
		}
		privateKey = decoded
	} else {
		privateKey = make([]byte, 32)
		if _, err := rand.Read(privateKey); err != nil {
			return nil, err
		}
	}

	priv, _ := btcec.PrivKeyFromBytes(privateKey)
	publicKey := priv.PubKey().SerializeCompressed()
	address, err := cosmosAddress(priv, "cosmos")
	if err != nil {
		return nil, err
	}

	return &Wallet{
		UserID:     req.UserID,
		Type:       req.Type,
		Blockchain: req.Blockchain,
		Address:    address,
		PublicKey:  hex.EncodeToString(publicKey),
		PrivateKey: hex.EncodeToString(privateKey),
		Status:     WalletStatusActive,
		Balance:    make(map[string]Balance),
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
	}, nil
}

// ============================================================================
// HD WALLET DERIVATION
// ============================================================================

// deriveEVmKeyFromSeed derives an EVM key at m/44'/60'/0'/0/<userID>.
func deriveEVmKeyFromSeed(seed string, userID uint64) (*ecdsa.PrivateKey, error) {
	path := fmt.Sprintf("m/44'/60'/0'/0/%d", userID)
	priv, err := DeriveBIP32PrivateKey(seed, "", path)
	if err != nil {
		return nil, err
	}
	return priv.ToECDSA(), nil
}

// deriveBitcoinKeyFromSeed derives a Bitcoin key at m/44'/0'/0'/0/<userID>.
func deriveBitcoinKeyFromSeed(seed string, userID uint64) (*btcutil.WIF, error) {
	path := fmt.Sprintf("m/44'/0'/0'/0/%d", userID)
	priv, err := DeriveBIP32PrivateKey(seed, "", path)
	if err != nil {
		return nil, err
	}
	return btcutil.NewWIF(priv, &chaincfg.MainNetParams, true)
}

// deriveSolanaKeyFromSeed derives a Solana key at m/44'/501'/<userID>'/0' using
// SLIP-0010, which Solana wallets follow.
func deriveSolanaKeyFromSeed(seed string, userID uint64) (ed25519.PrivKey, error) {
	path := fmt.Sprintf("m/44'/501'/%d'/0'", userID)
	raw, err := DeriveSlip10Ed25519(seed, "", path)
	if err != nil {
		return nil, err
	}
	var key ed25519.PrivKey
	copy(key[:], raw)
	return key, nil
}

// deriveTONKeyFromSeed derives a TON key. TON does not use BIP39 seed
// expansion; it hashes the phrase directly.
func deriveTONKeyFromSeed(seed string, userID uint64) ([]byte, error) {
	return tonPrivateKeyFromMnemonic(seed)
}

// deriveCosmosKeyFromSeed derives a Cosmos key at m/44'/118'/0'/0/<userID>.
func deriveCosmosKeyFromSeed(seed string, userID uint64) ([]byte, error) {
	path := fmt.Sprintf("m/44'/118'/0'/0/%d", userID)
	priv, err := DeriveBIP32PrivateKey(seed, "", path)
	if err != nil {
		return nil, err
	}
	return priv.Serialize(), nil
}

// ============================================================================
// WALLET OPERATIONS
// ============================================================================

func (s *WalletService) GetWallet(ctx context.Context, userID uint64, blockchain string) (*Wallet, error) {
	// Check local cache first
	s.mu.RLock()
	if userWallets, ok := s.wallets[userID]; ok {
		if wallet, ok := userWallets[blockchain]; ok {
			s.mu.RUnlock()
			return wallet, nil
		}
	}
	s.mu.RUnlock()

	// Load from database
	wallets, err := s.db.GetUserWallets(ctx, userID)
	if err != nil {
		return nil, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	for _, wallet := range wallets {
		if s.wallets[wallet.UserID] == nil {
			s.wallets[wallet.UserID] = make(map[string]*Wallet)
		}
		s.wallets[wallet.UserID][wallet.Blockchain] = wallet

		if wallet.Blockchain == blockchain {
			return wallet, nil
		}
	}

	return nil, errors.New("wallet not found")
}

func (s *WalletService) GetUserWallets(ctx context.Context, userID uint64) ([]*Wallet, error) {
	// Check local cache
	s.mu.RLock()
	if userWallets, ok := s.wallets[userID]; ok && len(userWallets) > 0 {
		wallets := make([]*Wallet, 0, len(userWallets))
		for _, w := range userWallets {
			wallets = append(wallets, w)
		}
		s.mu.RUnlock()
		return wallets, nil
	}
	s.mu.RUnlock()

	// Load from database
	wallets, err := s.db.GetUserWallets(ctx, userID)
	if err != nil {
		return nil, err
	}

	// Cache locally
	s.mu.Lock()
	for _, wallet := range wallets {
		if s.wallets[wallet.UserID] == nil {
			s.wallets[wallet.UserID] = make(map[string]*Wallet)
		}
		s.wallets[wallet.UserID][wallet.Blockchain] = wallet
	}
	s.mu.Unlock()

	return wallets, nil
}

func (s *WalletService) GenerateAddress(ctx context.Context, req *GenerateAddressRequest) (string, error) {
	wallet, err := s.GetWallet(ctx, req.UserID, req.Blockchain)
	if err != nil {
		return "", err
	}

	blockchain, ok := SupportedBlockchains[req.Blockchain]
	if !ok {
		return "", fmt.Errorf("unsupported blockchain: %s", req.Blockchain)
	}

	// For HD wallets, derive new address based on index
	if blockchain.Type == BlockchainTypeEVM {
		return deriveEVMAddress(wallet.SeedPhrase, wallet.UserID, req.Index)
	}

	return wallet.Address, nil
}

func deriveEVMAddress(seed string, userID uint64, index uint32) (string, error) {
	path := fmt.Sprintf("m/44'/60'/0'/0/%d", userID+uint64(index))
	hash := sha256.Sum256([]byte(seed + path))

	privateKey, err := crypto.ToECDSA(hash[:32])
	if err != nil {
		return "", err
	}

	address := crypto.PubkeyToAddress(*privateKey.Public().(*ecdsa.PublicKey))
	return address.Hex(), nil
}

// ============================================================================
// BALANCE OPERATIONS
// ============================================================================

func (s *WalletService) GetBalance(ctx context.Context, userID uint64, blockchain, token string) (*Balance, error) {
	// Try cache first
	cacheKey := fmt.Sprintf("balance:%d:%s:%s", userID, blockchain, token)
	var cachedBalance Balance
	if err := s.redis.Get(ctx, cacheKey, &cachedBalance); err == nil {
		return &cachedBalance, nil
	}

	// Get from database
	balance, err := s.db.GetBalance(ctx, userID, blockchain, token)
	if err != nil {
		return nil, err
	}

	// Fetch real balance from blockchain
	wallet, err := s.GetWallet(ctx, userID, blockchain)
	if err == nil {
		onChainBalance, err := s.blockchain.GetBalance(ctx, blockchain, wallet.Address, token)
		if err == nil {
			balance.Total = onChainBalance
			// Update DB with on-chain balance
			s.db.UpdateBalance(ctx, userID, blockchain, token, balance)
		}
	}

	// Cache for 30 seconds
	s.redis.Set(ctx, cacheKey, balance, 30*time.Second)

	return balance, nil
}

func (s *WalletService) GetAllBalances(ctx context.Context, userID uint64) (map[string]map[string]Balance, error) {
	wallets, err := s.GetUserWallets(ctx, userID)
	if err != nil {
		return nil, err
	}

	result := make(map[string]map[string]Balance)

	for _, wallet := range wallets {
		result[wallet.Blockchain] = make(map[string]Balance)

		// Get native token balance
		balance, err := s.GetBalance(ctx, userID, wallet.Blockchain, wallet.Blockchain)
		if err == nil {
			result[wallet.Blockchain][wallet.Blockchain] = *balance
		}
	}

	return result, nil
}

// ============================================================================
// DEPOSIT
// ============================================================================

// HandleDeposit credits a deposit after it has reached the required number of
// on-chain confirmations.
//
// The previous version credited the full amount to the user's available
// balance and marked the transaction completed as soon as a BlockTx was seen,
// with no receipt lookup and no confirmation count. Any unconfirmed or
// reorged transaction, and any replayed callback, credited real balance.
func (s *WalletService) HandleDeposit(ctx context.Context, tx *BlockTx) error {
	wallet, err := s.db.GetWalletByAddress(ctx, tx.To)
	if err != nil {
		s.logger.Warn("Deposit to unknown address", "address", tx.To, "hash", tx.Hash)
		return err
	}

	value, ok := new(big.Float).SetString(tx.Value)
	if !ok || value.Sign() <= 0 {
		return fmt.Errorf("deposit %s has an invalid or non-positive value %q", tx.Hash, tx.Value)
	}

	// The token key is the wallet's chain for native deposits. This mirrors the
	// rest of the service, which keys native balances by chain.
	token := wallet.Blockchain

	// Reject anything the chain has not actually included.
	receipt, err := s.blockchain.GetTransactionReceipt(ctx, wallet.Blockchain, tx.Hash)
	if err != nil {
		return fmt.Errorf("failed to verify deposit receipt for %s: %w", tx.Hash, err)
	}
	if receipt == nil {
		return fmt.Errorf("no on-chain receipt for deposit %s", tx.Hash)
	}
	if !receipt.Status {
		return fmt.Errorf("deposit %s failed on chain", tx.Hash)
	}

	currentHeight, err := s.blockchain.GetBlockNumber(ctx, wallet.Blockchain)
	if err != nil {
		return fmt.Errorf("failed to read chain height: %w", err)
	}
	confirmations := 0
	if currentHeight >= receipt.BlockNumber {
		confirmations = int(currentHeight-receipt.BlockNumber) + 1
	}

	required := s.config.Confirmations
	if info, ok := SupportedBlockchains[wallet.Blockchain]; ok && info.Confirmations > 0 {
		required = info.Confirmations
	}

	// A deposit already seen must not be credited twice. Update its
	// confirmation count instead.
	if existing, _ := s.db.GetTransactionByHash(ctx, tx.Hash); existing != nil {
		if existing.Status == TxStatusCompleted {
			return nil
		}
		existing.Confirmations = confirmations
		existing.UpdatedAt = time.Now()
		if confirmations >= required {
			return s.creditDeposit(ctx, wallet, existing, token, value)
		}
		existing.Status = TxStatusConfirming
		return s.db.UpdateTransaction(ctx, existing)
	}

	transaction := &Transaction{
		UserID:        wallet.UserID,
		WalletID:      wallet.ID,
		Hash:          tx.Hash,
		BlockNumber:   receipt.BlockNumber,
		From:          tx.From,
		To:            tx.To,
		Value:         tx.Value,
		Token:         token,
		Status:        TxStatusConfirming,
		Type:          TxTypeDeposit,
		Confirmations: confirmations,
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
	}

	if confirmations < required {
		transaction.Status = TxStatusPending
		if err := s.db.CreateTransaction(ctx, transaction); err != nil {
			return err
		}
		s.logger.Info("Deposit awaiting confirmations",
			"user_id", wallet.UserID, "hash", tx.Hash,
			"confirmations", confirmations, "required", required)
		return nil
	}

	if err := s.db.CreateTransaction(ctx, transaction); err != nil {
		return err
	}
	return s.creditDeposit(ctx, wallet, transaction, token, value)
}

// parseAmount converts a stored balance string to a float, treating an empty
// or malformed value as zero. big.Float.SetString returns a nil pointer on
// failure, and passing that to Add panics.
func parseAmount(s string) *big.Float {
	if f, ok := new(big.Float).SetString(s); ok {
		return f
	}
	return new(big.Float)
}

// creditDeposit adds a confirmed deposit to the user's available balance and
// marks the transaction completed.
func (s *WalletService) creditDeposit(ctx context.Context, wallet *Wallet, transaction *Transaction, token string, value *big.Float) error {
	balance, err := s.db.GetBalance(ctx, wallet.UserID, wallet.Blockchain, token)
	if err != nil || balance == nil {
		balance = &Balance{}
	}

	newBalance := new(big.Float).Add(parseAmount(balance.Available), value)

	balance.Available = newBalance.String()
	balance.Total = balance.Available
	usdValue, err := s.calculateUSDValue(balance.Total, token)
	if err != nil {
		// A missing price must not block a confirmed deposit, but it must not
		// be reported as a real valuation either.
		s.logger.Warn("Deposit USD valuation unavailable", "token", token, "error", err)
	}
	balance.USDValue = usdValue

	if err := s.db.UpdateBalance(ctx, wallet.UserID, wallet.Blockchain, token, balance); err != nil {
		return err
	}

	transaction.Status = TxStatusCompleted
	completedAt := time.Now()
	transaction.CompletedAt = &completedAt
	transaction.UpdatedAt = completedAt
	if err := s.db.UpdateTransaction(ctx, transaction); err != nil {
		return err
	}

	s.notifier.SendDepositNotification(wallet.UserID, transaction.Value, transaction.Hash)

	amount, _ := value.Float64()
	s.analytics.TrackDeposit(wallet.UserID, amount, wallet.Blockchain)

	s.logger.Info("Deposit credited", "user_id", wallet.UserID, "amount", transaction.Value, "hash", transaction.Hash)

	return nil
}

// ============================================================================
// WITHDRAWAL
// ============================================================================

func (s *WalletService) Withdraw(ctx context.Context, req *WithdrawRequest) (*Transaction, error) {
	// Validate amount
	if req.Amount < s.config.MinWithdrawal {
		return nil, fmt.Errorf("minimum withdrawal is %f", s.config.MinWithdrawal)
	}

	if req.Amount > s.config.MaxWithdrawal {
		return nil, fmt.Errorf("maximum withdrawal is %f", s.config.MaxWithdrawal)
	}

	// Validate address format
	if err := s.validateAddress(req.Blockchain, req.ToAddress); err != nil {
		return nil, fmt.Errorf("invalid address: %w", err)
	}

	// Get user wallet
	wallet, err := s.GetWallet(ctx, req.UserID, req.Blockchain)
	if err != nil {
		return nil, errors.New("wallet not found")
	}

	// Check balance
	balance, err := s.GetBalance(ctx, req.UserID, req.Blockchain, req.Token)
	if err != nil {
		return nil, err
	}

	balanceFloat, _ := new(big.Float).SetString(balance.Available)
	amountFloat := new(big.Float).SetFloat64(req.Amount)

	if balanceFloat.Cmp(amountFloat) < 0 {
		return nil, errors.New("insufficient balance")
	}

	// Get gas price
	if _, err := s.blockchain.GetGasPrice(ctx, req.Blockchain); err != nil {
		return nil, fmt.Errorf("failed to get gas price: %w", err)
	}

	// Calculate fee
	feeFloat := s.calculateWithdrawalFee(req.Amount, req.Blockchain)
	if req.Fee > 0 {
		feeFloat = req.Fee
	}

	totalFloat := new(big.Float).Add(amountFloat, new(big.Float).SetFloat64(feeFloat))

	if balanceFloat.Cmp(totalFloat) < 0 {
		return nil, errors.New("insufficient balance including fee")
	}

	// Lock balance
	balance.Available = new(big.Float).Sub(balanceFloat, totalFloat).String()
	s.db.UpdateBalance(ctx, req.UserID, req.Blockchain, req.Token, balance)

	// Create withdrawal record
	withdrawal := &Withdrawal{
		UserID:     req.UserID,
		WalletID:   wallet.ID,
		Blockchain: req.Blockchain,
		ToAddress:  req.ToAddress,
		Amount:     amountFloat.String(),
		Fee:        new(big.Float).SetFloat64(feeFloat).String(),
		Status:     WithdrawalStatusProcessing,
		Memo:       req.Memo,
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
	}

	if err := s.db.CreateWithdrawal(ctx, withdrawal); err != nil {
		return nil, err
	}

	// Send transaction to blockchain
	txHash, err := s.blockchain.SendTransaction(
		ctx,
		req.Blockchain,
		wallet.Address,
		req.ToAddress,
		amountFloat.String(),
		"",
	)
	if err != nil {
		withdrawal.Status = WithdrawalStatusFailed
		s.db.UpdateWithdrawal(ctx, withdrawal)

		// Refund balance
		balance.Available = new(big.Float).Add(balanceFloat, totalFloat).String()
		s.db.UpdateBalance(ctx, req.UserID, req.Blockchain, req.Token, balance)

		return nil, fmt.Errorf("failed to send transaction: %w", err)
	}

	// Update withdrawal
	withdrawal.TxHash = txHash
	s.db.UpdateWithdrawal(ctx, withdrawal)

	// Create transaction record
	transaction := &Transaction{
		UserID:    req.UserID,
		WalletID:  wallet.ID,
		Hash:      txHash,
		From:      wallet.Address,
		To:        req.ToAddress,
		Value:     amountFloat.String(),
		Fee:       new(big.Float).SetFloat64(feeFloat).String(),
		Token:     req.Token,
		Status:    TxStatusPending,
		Type:      TxTypeWithdrawal,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	if err := s.db.CreateTransaction(ctx, transaction); err != nil {
		return nil, err
	}

	// Track analytics
	s.analytics.TrackWithdrawal(req.UserID, req.Amount, req.Blockchain)

	s.logger.Info("Withdrawal initiated", "user_id", req.UserID, "amount", req.Amount, "hash", txHash)

	return transaction, nil
}

// ============================================================================
// INTERNAL TRANSFER
// ============================================================================

func (s *WalletService) Transfer(ctx context.Context, req *TransferRequest) (*Transaction, error) {
	// Get sender balance
	senderBalance, err := s.GetBalance(ctx, req.UserID, req.Blockchain, req.Token)
	if err != nil {
		return nil, err
	}

	amountFloat := new(big.Float).SetFloat64(req.Amount)
	senderBalanceFloat := parseAmount(senderBalance.Available)

	if senderBalanceFloat.Cmp(amountFloat) < 0 {
		return nil, errors.New("insufficient balance")
	}

	// Deduct from sender
	senderBalance.Available = new(big.Float).Sub(senderBalanceFloat, amountFloat).String()
	s.db.UpdateBalance(ctx, req.UserID, req.Blockchain, req.Token, senderBalance)

	// Add to receiver
	receiverBalance, err := s.db.GetBalance(ctx, req.ToUserID, req.Blockchain, req.Token)
	if err != nil {
		receiverBalance = &Balance{}
	}
	receiverBalance.Available = new(big.Float).Add(parseAmount(receiverBalance.Available), amountFloat).String()
	receiverBalance.Total = receiverBalance.Available
	s.db.UpdateBalance(ctx, req.ToUserID, req.Blockchain, req.Token, receiverBalance)

	// Create transaction record
	transaction := &Transaction{
		UserID:    req.UserID,
		From:      fmt.Sprintf("user:%d", req.UserID),
		To:        fmt.Sprintf("user:%d", req.ToUserID),
		Value:     amountFloat.String(),
		Token:     req.Token,
		Status:    TxStatusCompleted,
		Type:      TxTypeInternal,
		CreatedAt: time.Now(),
	}

	if err := s.db.CreateTransaction(ctx, transaction); err != nil {
		return nil, err
	}

	// Send notification
	s.notifier.SendTransferNotification(req.ToUserID, fmt.Sprintf("%f", req.Amount), req.UserID)

	// Track analytics
	s.analytics.TrackTransfer(req.UserID, req.Amount, req.ToUserID)

	s.logger.Info("Internal transfer", "from", req.UserID, "to", req.ToUserID, "amount", req.Amount)

	return transaction, nil
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

func (s *WalletService) validateAddress(blockchain, address string) error {
	blockchainInfo, ok := SupportedBlockchains[blockchain]
	if !ok {
		return fmt.Errorf("unsupported blockchain: %s", blockchain)
	}

	switch blockchainInfo.Type {
	case BlockchainTypeEVM:
		return s.validateEVMAddress(address)
	case BlockchainTypeBitcoin:
		return s.validateBitcoinAddress(address)
	case BlockchainTypeSolana:
		return s.validateSolanaAddress(address)
	case BlockchainTypeTON:
		return s.validateTONAddress(address)
	case BlockchainTypeCosmos:
		return s.validateCosmosAddress(address)
	default:
		return fmt.Errorf("unsupported blockchain type: %s", blockchainInfo.Type)
	}
}

func (s *WalletService) validateEVMAddress(address string) error {
	if !common.IsHexAddress(address) {
		return errors.New("invalid Ethereum address")
	}
	return nil
}

func (s *WalletService) validateBitcoinAddress(address string) error {
	_, err := btcutil.DecodeAddress(address, &chaincfg.MainNetParams)
	if err != nil {
		return errors.New("invalid Bitcoin address")
	}
	return nil
}

func (s *WalletService) validateSolanaAddress(address string) error {
	decoded, err := base58.Decode(address)
	if err != nil || len(decoded) != 32 {
		return errors.New("invalid Solana address")
	}
	return nil
}

func (s *WalletService) validateTONAddress(address string) error {
	if !strings.HasPrefix(address, "EQ") {
		return errors.New("invalid TON address")
	}
	return nil
}

func (s *WalletService) validateCosmosAddress(address string) error {
	if !strings.HasPrefix(address, "cosmos1") {
		return errors.New("invalid Cosmos address")
	}
	if len(address) != 44 {
		return errors.New("invalid Cosmos address length")
	}
	return nil
}

// ============================================================================
// FEE CALCULATION
// ============================================================================

func (s *WalletService) calculateWithdrawalFee(amount float64, blockchain string) float64 {
	blockchainInfo, ok := SupportedBlockchains[blockchain]
	if !ok {
		return 0
	}

	// For EVM chains, estimate gas
	if blockchainInfo.Type == BlockchainTypeEVM {
		gasLimit := blockchainInfo.GasLimit
		// Assume 50 Gwei gas price
		gasPrice := float64(50e9)
		return float64(gasLimit) * gasPrice / 1e18
	}

	// For other chains, use percentage
	return amount * s.config.WithdrawalFeePercent / 100
}

// calculateUSDValue converts amountStr of token to USD.
//
// The previous version multiplied by a hardcoded table (BTC = 65000,
// ETH = 3500, ...) and returned a zero price for any unknown token, so every
// USD valuation was wrong and silently so.
func (s *WalletService) calculateUSDValue(amountStr, token string) (float64, error) {
	amount, ok := new(big.Float).SetString(amountStr)
	if !ok {
		return 0, fmt.Errorf("invalid amount %q", amountStr)
	}

	price, err := s.getTokenPrice(token)
	if err != nil {
		return 0, err
	}

	usdValue := new(big.Float).Mul(amount, new(big.Float).SetFloat64(price))
	floatVal, _ := usdValue.Float64()
	return floatVal, nil
}

// getTokenPrice returns the current USD price of token from the configured
// price provider.
func (s *WalletService) getTokenPrice(token string) (float64, error) {
	if s.price == nil {
		return 0, errors.New("no price provider configured")
	}
	price, err := s.price.GetPrice(context.Background(), token)
	if err != nil {
		return 0, fmt.Errorf("price unavailable for %s: %w", token, err)
	}
	if price <= 0 {
		return 0, fmt.Errorf("price provider returned a non-positive price for %s", token)
	}
	return price, nil
}

// Errors
var (
	ErrWalletNotFound      = errors.New("wallet not found")
	ErrInsufficientBalance = errors.New("insufficient balance")
	ErrInvalidAddress      = errors.New("invalid address")
	ErrTransactionFailed   = errors.New("transaction failed")
)
