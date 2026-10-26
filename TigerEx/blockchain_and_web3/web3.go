package web3

import (
	"context"
	"crypto/ecdsa"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"math/big"
	"strconv"
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
	"github.com/tyler-smith/go-bip32"
	"github.com/tyler-smith/go-bip39"
)

// ============================================================================
// WEB3 WALLET SERVICE - PRODUCTION IMPLEMENTATION
// ============================================================================

// WalletType represents the type of wallet
type WalletType string

const (
	WalletTypeEVM    WalletType = "evm"
	WalletTypeSolana WalletType = "solana"
	WalletTypeTON    WalletType = "ton"
	WalletTypeAptos  WalletType = "aptos"
)

// Wallet represents a Web3 wallet
type Wallet struct {
	ID         string     `json:"id"`
	UserID     string     `json:"user_id"`
	Address    string     `json:"address"`
	PublicKey  string     `json:"public_key"`
	WalletType WalletType `json:"wallet_type"`
	ChainID    uint64     `json:"chain_id"`
	IsImported bool       `json:"is_imported"`
	CreatedAt  int64      `json:"created_at"`
	UpdatedAt  int64      `json:"updated_at"`
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
	Address    string          `json:"address"`
	Symbol     string          `json:"symbol"`
	Name       string          `json:"name"`
	Decimals   uint8           `json:"decimals"`
	Balance    decimal.Decimal `json:"balance"`
	RawBalance *big.Int        `json:"-"`
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
	ID          uint64 `json:"id"`
	Name        string `json:"name"`
	Symbol      string `json:"symbol"`
	ExplorerURL string `json:"explorer_url"`
	RPCURL      string `json:"rpc_url"`
	ChainID     uint64 `json:"chain_id"`
	IsTestnet   bool   `json:"is_testnet"`
}

// Web3Service manages Web3 wallets and interactions
type Web3Service struct {
	chains       map[uint64]*ChainConfig
	clients      map[uint64]*ethclient.Client
	wallets      map[string]*Wallet
	transactions map[string]*Transaction
	config       *Web3Config

	mu sync.RWMutex `json:"-"`
}

// Web3Config contains configuration
type Web3Config struct {
	SupportedChains    []uint64
	MaxGasPrice        string
	DefaultGasLimit    uint64
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
		chains:       make(map[uint64]*ChainConfig),
		clients:      make(map[uint64]*ethclient.Client),
		wallets:      make(map[string]*Wallet),
		transactions: make(map[string]*Transaction),
		config:       &config,
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
	// Ethereum and every EVM chain use secp256k1. The previous version used
	// elliptic.P256(), so the derived addresses were not valid EVM addresses
	// and no key it produced could ever spend from them.
	privateKey, err := ecdsa.GenerateKey(crypto.S256(), rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("failed to generate key: %w", err)
	}

	// Get public key and address
	address := crypto.PubkeyToAddress(privateKey.PublicKey)

	wallet := &Wallet{
		ID:         fmt.Sprintf("wallet_%s", uuid.New().String()[:8]),
		UserID:     userID,
		Address:    address.Hex(),
		PublicKey:  hex.EncodeToString(crypto.FromECDSAPub(&privateKey.PublicKey)),
		WalletType: WalletTypeEVM,
		ChainID:    chainID,
		IsImported: false,
		CreatedAt:  time.Now().UnixMilli(),
		UpdatedAt:  time.Now().UnixMilli(),
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
		UpdatedAt:  time.Now().UnixMilli(),
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

	// ERC20 balanceOf(address) selector followed by the address left-padded to
	// 32 bytes. The previous version used fmt.Sprintf("%064s", ...), which pads
	// with spaces rather than zeros, so the calldata was malformed and every
	// call reverted.
	methodID := "0x70a08231"
	addressBytes := common.HexToAddress(address).Bytes()
	paddedAddress := hex.EncodeToString(append(make([]byte, 12), addressBytes...))

	data := methodID + paddedAddress

	tokenAddr := common.HexToAddress(tokenAddress)
	callMsg := ethereum.CallMsg{
		To:   &tokenAddr,
		Data: common.FromHex(data),
	}

	result, err := client.CallContract(ctx, callMsg, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to call contract: %w", err)
	}

	balance := new(big.Int).SetBytes(result)

	return &TokenBalance{
		Address:    tokenAddress,
		Symbol:     "TOKEN",
		Name:       "Token",
		Decimals:   18,
		Balance:    decimal.NewFromBigInt(balance, -18),
		RawBalance: balance,
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

	// The transaction is signed by privateKey, so the recorded sender must be
	// the address that key controls. Otherwise a caller could attribute a
	// transfer to an address it does not own.
	signerAddress := crypto.PubkeyToAddress(privateKey.PublicKey)
	if !strings.EqualFold(signerAddress.Hex(), common.HexToAddress(from).Hex()) {
		return nil, fmt.Errorf("from address does not match the signing key")
	}

	// Get nonce
	nonce, err := client.PendingNonceAt(ctx, signerAddress)
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
		ID:        fmt.Sprintf("tx_%s", uuid.New().String()[:8]),
		Hash:      signedTx.Hash().Hex(),
		From:      from,
		To:        to,
		Amount:    amount,
		GasPrice:  decimal.NewFromBigInt(gasPrice, -9),
		GasLimit:  s.config.DefaultGasLimit,
		Nonce:     nonce,
		Status:    "pending",
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

	blockNumber := uint64(0)
	if receipt.BlockNumber != nil && receipt.BlockNumber.IsUint64() {
		blockNumber = receipt.BlockNumber.Uint64()
	}
	return &Transaction{
		Hash:        txHash,
		BlockNumber: blockNumber,
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

	toAddr := common.HexToAddress(to)
	msg := ethereum.CallMsg{
		From:  common.HexToAddress(from),
		To:    &toAddr,
		Value: amountWei,
		Gas:   0,
	}

	gas, err := client.EstimateGas(ctx, msg)
	if err != nil {
		// Silently substituting a default could under- or over-pay for gas.
		return 0, fmt.Errorf("gas estimation failed: %w", err)
	}

	// Add 20% buffer
	return gas * 120 / 100, nil
}

// SignMessage signs a message with wallet private key
// SignMessage signs a message with EIP-191 personal_sign semantics.
//
// The previous version hashed with SHA-256, but Ethereum signs a Keccak-256
// digest over a length-prefixed message. A signature it produced could not be
// verified by any wallet, and its own verifier only accepted its own wrong
// scheme.
func (s *Web3Service) SignMessage(message string, privateKeyHex string) (string, error) {
	privateKey, err := crypto.HexToECDSA(strings.TrimPrefix(privateKeyHex, "0x"))
	if err != nil {
		return "", fmt.Errorf("invalid private key: %w", err)
	}

	sig, err := crypto.Sign(eip191Hash(message), privateKey)
	if err != nil {
		return "", fmt.Errorf("failed to sign: %w", err)
	}

	return hex.EncodeToString(sig), nil
}

// eip191Hash returns the Keccak-256 digest of the EIP-191 personal message.
func eip191Hash(message string) []byte {
	prefix := fmt.Sprintf("\x19Ethereum Signed Message:\n%d", len(message))
	return crypto.Keccak256([]byte(prefix + message))
}

// VerifySignature verifies an EIP-191 personal_sign signature.
func (s *Web3Service) VerifySignature(message, signature, address string) bool {
	sig := common.FromHex(signature)
	if len(sig) != 65 {
		return false
	}
	// Normalise the recovery id: some producers return 0/1, others 27/28.
	if sig[64] >= 27 {
		sig[64] -= 27
	}

	pubKey, err := crypto.SigToPub(eip191Hash(message), sig)
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
	Mnemonic  string
	MasterKey *MasterKey
	ChildKeys map[uint32]*ChildKey
}

// MasterKey represents master key
type MasterKey struct {
	Key       string
	ChainCode string
}

// ChildKey represents derived child key
type ChildKey struct {
	PrivateKey string
	PublicKey  string
	Address    string
	Path       string
}

// GenerateMnemonic generates a new BIP39 mnemonic of the requested length.
//
// The previous version concatenated the same 24 dictionary words in a fixed
// cycle, so it produced a single deterministic phrase regardless of the
// request and had no entropy at all.
func GenerateMnemonic(wordCount int) (string, error) {
	var strength int
	switch wordCount {
	case 12:
		strength = 128
	case 15:
		strength = 160
	case 18:
		strength = 192
	case 21:
		strength = 224
	case 24:
		strength = 256
	default:
		return "", fmt.Errorf("unsupported mnemonic length %d: use 12, 15, 18, 21, or 24", wordCount)
	}

	entropy, err := bip39.NewEntropy(strength)
	if err != nil {
		return "", err
	}
	return bip39.NewMnemonic(entropy)
}

// GenerateHDWallet creates a BIP39 seed and its BIP32 master key.
func GenerateHDWallet(wordCount int) (*HDWallet, error) {
	mnemonic, err := GenerateMnemonic(wordCount)
	if err != nil {
		return nil, err
	}

	seed, err := bip39.NewSeedWithErrorChecking(mnemonic, "")
	if err != nil {
		return nil, err
	}

	master, err := bip32.NewMasterKey(seed)
	if err != nil {
		return nil, err
	}

	return &HDWallet{
		Mnemonic: mnemonic,
		MasterKey: &MasterKey{
			Key:       hex.EncodeToString(master.Key),
			ChainCode: hex.EncodeToString(master.ChainCode),
		},
		ChildKeys: make(map[uint32]*ChildKey),
	}, nil
}

// DeriveChildKey derives a child key from a BIP32 master key along path.
//
// The previous version ignored the path entirely and returned the master key
// itself, so every "derived" address was the same address as the root.
func DeriveChildKey(masterKey *MasterKey, path string) (*ChildKey, error) {
	if masterKey == nil {
		return nil, fmt.Errorf("master key is required")
	}

	keyBytes, err := hex.DecodeString(strings.TrimPrefix(masterKey.Key, "0x"))
	if err != nil {
		return nil, fmt.Errorf("invalid master key: %w", err)
	}
	chainCode, err := hex.DecodeString(strings.TrimPrefix(masterKey.ChainCode, "0x"))
	if err != nil {
		return nil, fmt.Errorf("invalid chain code: %w", err)
	}

	key := &bip32.Key{
		Key:       keyBytes,
		ChainCode: chainCode,
		Version:   bip32.PrivateWalletVersion,
		IsPrivate: true,
	}

	indices, err := parseDerivationPath(path)
	if err != nil {
		return nil, err
	}
	for _, index := range indices {
		key, err = key.NewChildKey(index)
		if err != nil {
			return nil, err
		}
	}

	if len(key.Key) != 32 {
		return nil, fmt.Errorf("derived key is not a 32 byte secp256k1 scalar")
	}
	privateKey, _ := crypto.ToECDSA(key.Key)
	address := crypto.PubkeyToAddress(privateKey.PublicKey)

	return &ChildKey{
		PrivateKey: hex.EncodeToString(key.Key),
		PublicKey:  hex.EncodeToString(crypto.FromECDSAPub(&privateKey.PublicKey)),
		Address:    address.Hex(),
		Path:       path,
	}, nil
}

// parseDerivationPath converts "m/44'/60'/0'/0/0" into child indices.
func parseDerivationPath(path string) ([]uint32, error) {
	parts := strings.Split(path, "/")
	indices := make([]uint32, 0, len(parts))
	for _, part := range parts {
		if part == "" || part == "m" {
			continue
		}
		hardened := strings.HasSuffix(part, "'")
		part = strings.TrimSuffix(part, "'")
		n, err := strconv.ParseUint(part, 10, 32)
		if err != nil {
			return nil, fmt.Errorf("invalid derivation path segment %q", part)
		}
		index := uint32(n)
		if hardened {
			index += bip32.FirstHardenedChild
		}
		indices = append(indices, index)
	}
	return indices, nil
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

// Read calls a read-only contract method.
func (c *ContractCaller) Read(ctx context.Context, method string, args ...interface{}) ([]byte, error) {
	c.web3.mu.RLock()
	client, exists := c.web3.clients[c.chainID]
	c.web3.mu.RUnlock()

	if !exists {
		return nil, fmt.Errorf("not connected to chain")
	}

	data, err := packMethod(method, args...)
	if err != nil {
		return nil, err
	}

	msg := ethereum.CallMsg{
		To:   &c.contract,
		Data: data,
	}

	return client.CallContract(ctx, msg, nil)
}

// Write calls a write contract method.
func (c *ContractCaller) Write(ctx context.Context, privateKey string, method string, args ...interface{}) (string, error) {
	data, err := packMethod(method, args...)
	if err != nil {
		return "", err
	}

	c.web3.mu.RLock()
	client, exists := c.web3.clients[c.chainID]
	c.web3.mu.RUnlock()
	if !exists {
		return "", fmt.Errorf("not connected to chain")
	}

	key, err := crypto.HexToECDSA(strings.TrimPrefix(privateKey, "0x"))
	if err != nil {
		return "", fmt.Errorf("invalid private key: %w", err)
	}
	from := crypto.PubkeyToAddress(key.PublicKey)

	nonce, err := client.PendingNonceAt(ctx, from)
	if err != nil {
		return "", fmt.Errorf("failed to get nonce: %w", err)
	}
	gasPrice, err := client.SuggestGasPrice(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to get gas price: %w", err)
	}

	tx := types.NewTransaction(nonce, c.contract, big.NewInt(0), 50000, gasPrice, data)

	chainIDBig := big.NewInt(int64(c.chainID))
	signedTx, err := types.SignTx(tx, types.NewEIP155Signer(chainIDBig), key)
	if err != nil {
		return "", fmt.Errorf("failed to sign transaction: %w", err)
	}

	if err := client.SendTransaction(ctx, signedTx); err != nil {
		return "", err
	}

	return signedTx.Hash().Hex(), nil
}

// packMethod returns the calldata for a contract call.
//
// The previous version returned common.FromHex(method) and dropped every
// argument, so a call that passed arguments produced calldata for a
// zero-argument function and either reverted or invoked the wrong thing.
// Until a real ABI encoder is wired in, arguments are refused rather than
// silently discarded.
func packMethod(method string, args ...interface{}) ([]byte, error) {
	selector := common.FromHex(method)
	if len(selector) != 4 {
		return nil, fmt.Errorf("method selector must be 4 bytes, got %d", len(selector))
	}
	if len(args) > 0 {
		return nil, fmt.Errorf("ABI argument encoding is not implemented; refusing to drop %d argument(s)", len(args))
	}
	return selector, nil
}
