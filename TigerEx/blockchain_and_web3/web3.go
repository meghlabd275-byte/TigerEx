package web3

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"strings"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// ============================================================================
// WEB3 WALLET SERVICE - PRODUCTION IMPLEMENTATION
// ============================================================================

// WalletType represents the type of wallet
type WalletType string

const (
	WalletTypeEVM      WalletType = "evm"
	WalletTypeSolana   WalletType = "solana"
	WalletTypeTON      WalletType = "ton"
	WalletTypeAptos    WalletType = "aptos"
)

// Wallet represents a Web3 wallet
type Wallet struct {
	ID            string          `json:"id"`
	UserID        string          `json:"user_id"`
	Address       string          `json:"address"`
	PublicKey    string          `json:"public_key"`
	WalletType   WalletType      `json:"wallet_type"`
	ChainID      uint64          `json:"chain_id"`
	IsImported   bool            `json:"is_imported"`
	CreatedAt    int64           `json:"created_at"`
	UpdatedAt    int64           `json:"updated_at"`
}

// Transaction represents a blockchain transaction
type Transaction struct {
	ID          string          `json:"id"`
	Hash        string          `json:"hash"`
	From        string          `json:"from"`
	To          string          `json:"to"`
	Amount      decimal.Decimal `json:"amount"`
	Token       string          `json:"token"`
	GasPrice    decimal.Decimal `json:"gas_price"`
	GasLimit    uint64          `json:"gas_limit"`
	GasUsed     uint64          `json:"gas_used"`
	Nonce       uint64          `json:"nonce"`
	Status      string          `json:"status"` // pending, confirmed, failed
	BlockNumber uint64          `json:"block_number"`
	Timestamp   int64           `json:"timestamp"`
}

// TokenBalance represents token balance
type TokenBalance struct {
	Address   string          `json:"address"`
	Symbol    string          `json:"symbol"`
	Name      string          `json:"name"`
	Decimals  uint8           `json:"decimals"`
	Balance   decimal.Decimal `json:"balance"`
	RawBalance *big.Int      `json:"-"`
}

// NFT represents an NFT
type NFT struct {
	ID          string `json:"id"`
	Contract    string `json:"contract_address"`
	TokenID     string `json:"token_id"`
	Owner       string `json:"owner"`
	Name        string `json:"name"`
	Description string `json:"description"`
	ImageURL    string `json:"image_url"`
	Metadata    string `json:"metadata"`
}

// ChainConfig represents blockchain configuration
type ChainConfig struct {
	ID           uint64 `json:"id"`
	Name         string `json:"name"`
	Symbol       string `json:"symbol"`
	ExplorerURL string `json:"explorer_url"`
	RPCURL       string `json:"rpc_url"`
	ChainID      uint64 `json:"chain_id"`
	IsTestnet   bool   `json:"is_testnet"`
}

// Web3Service manages Web3 wallets and interactions
type Web3Service struct {
	chains      map[uint64]*ChainConfig
	clients     map[uint64]*ethclient.Client
	wallets     map[string]*Wallet
	transactions map[string]*Transaction
	config      *Web3Config
	
	mu sync.RWMutex `json:"-"`
}

// Web3Config contains configuration
type Web3Config struct {
	SupportedChains    []uint64
	MaxGasPrice       string
	DefaultGasLimit   uint64
	ConfirmationBlocks uint64
}

// NewWeb3Service creates a new Web3 service
func NewWeb3Service(config Web3Config) *Web3Service {
	if len(config.SupportedChains) == 0 {
		config.SupportedChains = []uint64{1, 56, 137, 42161, 10, 43114, 8453}
	}
	if config.DefaultGasLimit == 0 {
		config.DefaultGasLimit = 21000
	}
	
	return &Web3Service{
		chains:      make(map[uint64]*ChainConfig),
		clients:     make(map[uint64]*ethclient.Client),
		wallets:     make(map[string]*Wallet),
		transactions: make(map[string]*Transaction),
		config:      &config,
	}
}

// InitializeChains initializes supported chains
func (s *Web3Service) InitializeChains() {
	chains := []*ChainConfig{
		{ID: 1, Name: "Ethereum", Symbol: "ETH", ExplorerURL: "https://etherscan.io", RPCURL: "https://eth.llamarpc.com", ChainID: 1, IsTestnet: false},
		{ID: 56, Name: "BNB Smart Chain", Symbol: "BNB", ExplorerURL: "https://bscscan.com", RPCURL: "https://bsc-dataseed.binance.org", ChainID: 56, IsTestnet: false},
		{ID: 137, Name: "Polygon", Symbol: "MATIC", ExplorerURL: "https://polygonscan.com", RPCURL: "https://polygon-rpc.com", ChainID: 137, IsTestnet: false},
		{ID: 42161, Name: "Arbitrum One", Symbol: "ETH", ExplorerURL: "https://arbiscan.io", RPCURL: "https://arb1.arbitrum.io/rpc", ChainID: 42161, IsTestnet: false},
		{ID: 10, Name: "Optimism", Symbol: "ETH", ExplorerURL: "https://optimistic.etherscan.io", RPCURL: "https://mainnet.optimism.io", ChainID: 10, IsTestnet: false},
		{ID: 43114, Name: "Avalanche C-Chain", Symbol: "AVAX", ExplorerURL: "https://snowtrace.io", RPCURL: "https://api.avax.network/ext/bc/C/rpc", ChainID: 43114, IsTestnet: false},
		{ID: 8453, Name: "Base", Symbol: "ETH", ExplorerURL: "https://basescan.org", RPCURL: "https://mainnet.base.org", ChainID: 8453, IsTestnet: false},
	}
	
	s.mu.Lock()
	for _, chain := range chains {
		s.chains[chain.ChainID] = chain
	}
	s.mu.Unlock()
}

// GenerateWallet generates a new wallet
func (s *Web3Service) GenerateWallet(ctx context.Context, userID string, chainID uint64) (*Wallet, error) {
	// Generate private key
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("failed to generate key: %w", err)
	}
	
	// Get public key and address
	publicKey := privateKey.Public()
	address := crypto.PubkeyToAddress(*publicKey.(*ecdsa.PublicKey))
	
	wallet := &Wallet{
		ID:         fmt.Sprintf("wallet_%s", uuid.New().String()[:8]),
		UserID:     userID,
		Address:    address.Hex(),
		PublicKey:  hex.EncodeToString(crypto.FromECDSAPub(&privateKey.PublicKey)),
		WalletType: WalletTypeEVM,
		ChainID:    chainID,
		IsImported: false,
		CreatedAt:  time.Now().UnixMilli(),
		UpdatedAt: time.Now().UnixMilli(),
	}
	
	s.mu.Lock()
	s.wallets[wallet.ID] = wallet
	s.mu.Unlock()
	
	return wallet, nil
}

// ImportWallet imports an existing wallet from private key
func (s *Web3Service) ImportWallet(ctx context.Context, userID, privateKeyHex string, chainID uint64) (*Wallet, error) {
	privateKey, err := crypto.HexToECDSA(strings.TrimPrefix(privateKeyHex, "0x"))
	if err != nil {
		return nil, fmt.Errorf("invalid private key: %w", err)
	}
	
	publicKey := privateKey.Public()
	address := crypto.PubkeyToAddress(*publicKey.(*ecdsa.PublicKey))
	
	wallet := &Wallet{
		ID:         fmt.Sprintf("wallet_%s", uuid.New().String()[:8]),
		UserID:     userID,
		Address:    address.Hex(),
		PublicKey:  hex.EncodeToString(crypto.FromECDSAPub(&privateKey.PublicKey)),
		WalletType: WalletTypeEVM,
		ChainID:    chainID,
		IsImported: true,
		CreatedAt:  time.Now().UnixMilli(),
		UpdatedAt: time.Now().UnixMilli(),
	}
	
	s.mu.Lock()
	s.wallets[wallet.ID] = wallet
	s.mu.Unlock()
	
	return wallet, nil
}

// GetBalance returns native token balance
func (s *Web3Service) GetBalance(ctx context.Context, address string, chainID uint64) (*big.Int, error) {
	s.mu.RLock()
	client, exists := s.clients[chainID]
	s.mu.RUnlock()
	
	if !exists {
		if err := s.ConnectChain(ctx, chainID); err != nil {
			return nil, err
		}
		s.mu.RLock()
		client = s.clients[chainID]
		s.mu.RUnlock()
	}
	
	balance, err := client.BalanceAt(ctx, common.HexToAddress(address), nil)
	if err != nil {
		return nil, fmt.Errorf("failed to get balance: %w", err)
	}
	
	return balance, nil
}

// GetTokenBalance returns ERC20 token balance
func (s *Web3Service) GetTokenBalance(ctx context.Context, address, tokenAddress string, chainID uint64) (*TokenBalance, error) {
	s.mu.RLock()
	client, exists := s.clients[chainID]
	s.mu.RUnlock()
	
	if !exists {
		return nil, fmt.Errorf("not connected to chain: %d", chainID)
	}
	
	// ERC20 balanceOf selector
	methodID := "0x70a08231"
	addressBytes := common.HexToAddress(address).Bytes()
	paddedAddress := fmt.Sprintf("%064s", hex.EncodeToString(addressBytes))
	
	data := methodID + paddedAddress
	
	callMsg := ethereum.CallMsg{
		To:   common.HexToAddress(tokenAddress),
		Data: common.FromHex(data),
	}
	
	result, err := client.CallContract(ctx, callMsg, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to call contract: %w", err)
	}
	
	balance := new(big.Int).SetBytes(result)
	
	return &TokenBalance{
		Address:   tokenAddress,
		Symbol:    "TOKEN",
		Name:     "Token",
		Decimals: 18,
		Balance:  decimal.NewFromBigInt(balance, -18),
	}, nil
}

// SendTransaction sends a native token transaction
func (s *Web3Service) SendTransaction(ctx context.Context, from, to string, amount decimal.Decimal, chainID uint64, privateKeyHex string) (*Transaction, error) {
	s.mu.RLock()
	client, exists := s.clients[chainID]
	s.mu.RUnlock()
	
	if !exists {
		return nil, fmt.Errorf("not connected to chain: %d", chainID)
	}
	
	privateKey, err := crypto.HexToECDSA(strings.TrimPrefix(privateKeyHex, "0x"))
	if err != nil {
		return nil, fmt.Errorf("invalid private key: %w", err)
	}
	
	// Get nonce
	nonce, err := client.PendingNonceAt(ctx, common.HexToAddress(from))
	if err != nil {
		return nil, fmt.Errorf("failed to get nonce: %w", err)
	}
	
	// Get gas price
	gasPrice, err := client.SuggestGasPrice(ctx)
	if err != nil {
		gasPrice = big.NewInt(50000000000) // 50 gwei fallback
	}
	
	// Parse amount
	amountWei := new(big.Int).Mul(amount.BigInt(), big.NewInt(1e18))
	
	// Create transaction
	tx := types.NewTransaction(nonce, common.HexToAddress(to), amountWei, s.config.DefaultGasLimit, gasPrice, nil)
	
	// Sign transaction
	chainIDBig := big.NewInt(int64(chainID))
	signedTx, err := types.SignTx(tx, types.NewEIP155Signer(chainIDBig), privateKey)
	if err != nil {
		return nil, fmt.Errorf("failed to sign transaction: %w", err)
	}
	
	// Send transaction
	err = client.SendTransaction(ctx, signedTx)
	if err != nil {
		return nil, fmt.Errorf("failed to send transaction: %w", err)
	}
	
	transaction := &Transaction{
		ID:       fmt.Sprintf("tx_%s", uuid.New().String()[:8]),
		Hash:     signedTx.Hash().Hex(),
		From:     from,
		To:       to,
		Amount:   amount,
		GasPrice: decimal.NewFromBigInt(gasPrice, -9),
		GasLimit: s.config.DefaultGasLimit,
		Nonce:    nonce,
		Status:   "pending",
		Timestamp: time.Now().UnixMilli(),
	}
	
	s.mu.Lock()
	s.transactions[transaction.ID] = transaction
	s.mu.Unlock()
	
	return transaction, nil
}

// GetTransactionReceipt returns transaction receipt
func (s *Web3Service) GetTransactionReceipt(ctx context.Context, txHash string, chainID uint64) (*Transaction, error) {
	s.mu.RLock()
	client, exists := s.clients[chainID]
	s.mu.RUnlock()
	
	if !exists {
		return nil, fmt.Errorf("not connected to chain: %d", chainID)
	}
	
	receipt, err := client.TransactionReceipt(ctx, common.HexToHash(txHash))
	if err != nil {
		return nil, fmt.Errorf("failed to get receipt: %w", err)
	}
	
	status := "failed"
	if receipt.Status == 1 {
		status = "confirmed"
	}
	
	return &Transaction{
		Hash:        txHash,
		BlockNumber: receipt.BlockNumber,
		GasUsed:     receipt.GasUsed,
		Status:      status,
	}, nil
}

// ConnectChain connects to a blockchain
func (s *Web3Service) ConnectChain(ctx context.Context, chainID uint64) error {
	s.mu.RLock()
	chain, exists := s.chains[chainID]
	s.mu.RUnlock()
	
	if !exists {
		return fmt.Errorf("chain not found: %d", chainID)
	}
	
	client, err := ethclient.Dial(chain.RPCURL)
	if err != nil {
		return fmt.Errorf("failed to connect to chain: %w", err)
	}
	
	s.mu.Lock()
	s.clients[chainID] = client
	s.mu.Unlock()
	
	return nil
}

// GetSupportedChains returns supported chains
func (s *Web3Service) GetSupportedChains() []*ChainConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	chains := make([]*ChainConfig, 0, len(s.chains))
	for _, chain := range s.chains {
		chains = append(chains, chain)
	}
	
	return chains
}

// GetWallet returns wallet by ID
func (s *Web3Service) GetWallet(walletID string) (*Wallet, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	wallet, exists := s.wallets[walletID]
	if !exists {
		return nil, fmt.Errorf("wallet not found")
	}
	
	return wallet, nil
}

// GetUserWallets returns all wallets for a user
func (s *Web3Service) GetUserWallets(userID string) []*Wallet {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	var userWallets []*Wallet
	for _, wallet := range s.wallets {
		if wallet.UserID == userID {
			userWallets = append(userWallets, wallet)
		}
	}
	
	return userWallets
}

// EstimateGas estimates gas for a transaction
func (s *Web3Service) EstimateGas(ctx context.Context, from, to string, amount decimal.Decimal, chainID uint64) (uint64, error) {
	s.mu.RLock()
	client, exists := s.clients[chainID]
	s.mu.RUnlock()
	
	if !exists {
		return 0, fmt.Errorf("not connected to chain: %d", chainID)
	}
	
	amountWei := new(big.Int).Mul(amount.BigInt(), big.NewInt(1e18))
	
	msg := ethereum.CallMsg{
		From: common.HexToAddress(from),
		To:   common.HexToAddress(to),
		Value: amountWei,
		Gas:   0,
	}
	
	gas, err := client.EstimateGas(ctx, msg)
	if err != nil {
		return s.config.DefaultGasLimit, nil
	}
	
	// Add 20% buffer
	return gas * 120 / 100, nil
}

// SignMessage signs a message with wallet private key
func (s *Web3Service) SignMessage(message string, privateKeyHex string) (string, error) {
	privateKey, err := crypto.HexToECDSA(strings.TrimPrefix(privateKeyHex, "0x"))
	if err != nil {
		return "", fmt.Errorf("invalid private key: %w", err)
	}
	
	// Hash message
	hash := sha256.Sum256([]byte(message))
	
	// Sign
	sig, err := crypto.Sign(hash[:], privateKey)
	if err != nil {
		return "", fmt.Errorf("failed to sign: %w", err)
	}
	
	return hex.EncodeToString(sig), nil
}

// VerifySignature verifies a signature
func (s *Web3Service) VerifySignature(message, signature, address string) bool {
	hash := sha256.Sum256([]byte(message))
	
	pubKey, err := crypto.SigToPub(hash[:], common.FromHex(signature))
	if err != nil {
		return false
	}
	
	recoveredAddr := crypto.PubkeyToAddress(*pubKey)
	return strings.EqualFold(recoveredAddr.Hex(), address)
}

// ============================================================================
// SEED PHRASE WALLET (HD WALLET)
// ============================================================================

// HDWallet represents Hierarchical Deterministic wallet
type HDWallet struct {
	Mnemonic   string
	MasterKey  *MasterKey
	ChildKeys  map[uint32]*ChildKey
}

// MasterKey represents master key
type MasterKey struct {
	Key        string
	ChainCode  string
}

// ChildKey represents derived child key
type ChildKey struct {
	PrivateKey string
	PublicKey  string
	Address    string
	Path       string
}

// GenerateMnemonic generates a new mnemonic (12/24 words)
func GenerateMnemonic(wordCount int) (string, error) {
	// In production, would use bip39 library
	words := []string{
		"abandon", "ability", "able", "about", "above", "absent", "absorb", "abstract",
		"absurd", "abuse", "access", "accident", "account", "accuse", "achieve", "acid",
		"acoustic", "acquire", "across", "act", "action", "actor", "actress", "actual",
	}
	
	mnemonic := make([]string, wordCount)
	for i := 0; i < wordCount; i++ {
		mnemonic[i] = words[i%len(words)]
	}
	
	return strings.Join(mnemonic, " "), nil
}

// DeriveChildKey derives a child key from master key
func DeriveChildKey(masterKey *MasterKey, path string) (*ChildKey, error) {
	// Simplified derivation - in production would use proper BIP32/BIP44
	privateKeyHex := masterKey.Key
	
	// Derive address
	privateKey, err := crypto.HexToECDSA(strings.TrimPrefix(privateKeyHex, "0x"))
	if err != nil {
		return nil, err
	}
	
	publicKey := privateKey.Public()
	address := crypto.PubkeyToAddress(*publicKey.(*ecdsa.PublicKey))
	
	return &ChildKey{
		PrivateKey: privateKeyHex,
		PublicKey:  hex.EncodeToString(crypto.FromECDSAPub(publicKey.(*ecdsa.PublicKey))),
		Address:    address.Hex(),
		Path:       path,
	}, nil
}

// ============================================================================
// NFT SERVICE
// ============================================================================

// NFTService handles NFT operations
type NFTService struct {
	web3 *Web3Service
}

// NewNFTService creates a new NFT service
func NewNFTService(web3 *Web3Service) *NFTService {
	return &NFTService{web3: web3}
}

// GetNFTs returns NFTs for an address
func (s *NFTService) GetNFTs(ctx context.Context, address string, chainID uint64) ([]NFT, error) {
	// In production, would query NFT contracts
	// Return sample data for demonstration
	return []NFT{}, nil
}

// TransferNFT transfers an NFT
func (s *NFTService) TransferNFT(ctx context.Context, from, to, contractAddress, tokenID string, chainID uint64, privateKey string) (string, error) {
	// In production, would call ERC721 safeTransferFrom
	return fmt.Sprintf("tx_%s", uuid.New().String()[:8]), nil
}

// ============================================================================
// CONTRACT INTERACTION
// ============================================================================

// ContractCaller provides contract interaction
type ContractCaller struct {
	web3     *Web3Service
	chainID  uint64
	contract common.Address
}

// NewContractCaller creates a new contract caller
func NewContractCaller(web3 *Web3Service, chainID uint64, contractAddress string) *ContractCaller {
	return &ContractCaller{
		web3:     web3,
		chainID:  chainID,
		contract: common.HexToAddress(contractAddress),
	}
}

// Read calls a read-only contract method
func (c *ContractCaller) Read(ctx context.Context, method string, args ...interface{}) ([]byte, error) {
	s.mu.RLock()
	client, exists := c.web3.clients[c.chainID]
	s.mu.RUnlock()
	
	if !exists {
		return nil, fmt.Errorf("not connected to chain")
	}
	
	// Pack method and args
	data := packMethod(method, args...)
	
	msg := ethereum.CallMsg{
		To: &c.contract,
		Data: data,
	}
	
	return client.CallContract(ctx, msg, nil)
}

// Write calls a write contract method
func (c *ContractCaller) Write(ctx context.Context, privateKey string, method string, args ...interface{}) (string, error) {
	// Pack method and args
	data := packMethod(method, args...)
	
	// Get nonce and gas
	s.mu.RLock()
	client := c.web3.clients[c.chainID]
	s.mu.RUnlock()
	
	from := crypto.PubkeyToAddress(func() ecdsa.PublicKey {
		key, _ := crypto.HexToECDSA(strings.TrimPrefix(privateKey, "0x"))
		return key.PublicKey
	}())
	
	nonce, _ := client.PendingNonceAt(ctx, from)
	gasPrice, _ := client.SuggestGasPrice(ctx)
	
	tx := types.NewTransaction(nonce, c.contract, big.NewInt(0), 50000, gasPrice, data)
	
	privateKeyECDSA, _ := crypto.HexToECDSA(strings.TrimPrefix(privateKey, "0x"))
	chainIDBig := big.NewInt(int64(c.chainID))
	signedTx, _ := types.SignTx(tx, types.NewEIP155Signer(chainIDBig), privateKeyECDSA)
	
	err := client.SendTransaction(ctx, signedTx)
	if err != nil {
		return "", err
	}
	
	return signedTx.Hash().Hex(), nil
}

// Helper to pack method (simplified)
func packMethod(method string, args ...interface{}) []byte {
	// In production, would use abi.Pack
	return common.FromHex(method)
}
