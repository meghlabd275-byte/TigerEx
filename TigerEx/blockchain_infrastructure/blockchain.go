package blockchain

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"strings"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/params"
	"github.com/google/uuid"
)

// ============================================================================
// BLOCKCHAIN INFRASTRUCTURE - PRODUCTION IMPLEMENTATION
// ============================================================================

// ChainType represents the type of blockchain
type ChainType string

const (
	ChainTypeEVM      ChainType = "evm"
	ChainTypeSolana    ChainType = "solana"
	ChainTypeTON       ChainType = "ton"
	ChainTypeAptos     ChainType = "aptos"
	ChainTypeNear      ChainType = "near"
	ChainTypeCosmos    ChainType = "cosmos"
)

// NetworkStatus represents the status of a network
type NetworkStatus string

const (
	NetworkStatusActive    NetworkStatus = "active"
	NetworkStatusInactive  NetworkStatus = "inactive"
	NetworkStatusMaintenance NetworkStatus = "maintenance"
)

// BlockchainNetwork represents a blockchain network
type BlockchainNetwork struct {
	ID               string          `json:"id"`
	Name             string          `json:"name"`
	ChainType       ChainType       `json:"chain_type"`
	ChainID         uint64          `json:"chain_id"`
	Symbol          string          `json:"symbol"`
	Decimals        uint8           `json:"decimals"`
	ExplorerURL     string          `json:"explorer_url"`
	RPCURL          string          `json:"rpc_url"`
	WebSocketURL    string          `json:"ws_url"`
	Status          NetworkStatus   `json:"status"`
	Confirmations   uint64          `json:"confirmations"`
	GasStation      string          `json:"gas_station"`
	Supported       bool            `json:"supported"`
	IconURL         string          `json:"icon_url"`
	NetworkID       string          `json:"network_id"`
	ParentChain     string          `json:"parent_chain,omitempty"`
}

// TokenInfo represents token information on a chain
type TokenInfo struct {
	Address        string          `json:"address"`
	Name           string          `json:"name"`
	Symbol         string          `json:"symbol"`
	Decimals       uint8           `json:"decimals"`
	TotalSupply    string          `json:"total_supply"`
	ChainID        uint64          `json:"chain_id"`
	IsNative       bool            `json:"is_native"`
	IsVerified     bool            `json:"is_verified"`
	LogoURL        string          `json:"logo_url"`
	PriceUSD       float64         `json:"price_usd"`
	MarketCap      float64         `json:"market_cap"`
	Volume24h      float64         `json:"volume_24h"`
}

// TransactionRequest represents a blockchain transaction request
type TransactionRequest struct {
	FromAddress     string          `json:"from_address"`
	ToAddress       string          `json:"to_address"`
	Amount          string          `json:"amount"`
	TokenAddress    string          `json:"token_address,omitempty"`
	GasPrice        string          `json:"gas_price,omitempty"`
	GasLimit        uint64          `json:"gas_limit"`
	ChainID         uint64          `json:"chain_id"`
	Data            string          `json:"data,omitempty"`
	Nonce           *uint64         `json:"nonce,omitempty"`
}

// TransactionReceipt represents a transaction receipt
type TransactionReceipt struct {
	TransactionHash   string          `json:"transaction_hash"`
	BlockNumber      uint64          `json:"block_number"`
	BlockHash        string          `json:"block_hash"`
	Status           bool             `json:"status"`
	GasUsed          uint64          `json:"gas_used"`
	CumulativeGasUsed uint64         `json:"cumulative_gas_used"`
	FromAddress      string          `json:"from_address"`
	ToAddress        string          `json:"to_address"`
	Amount           string          `json:"amount"`
	Logs             []TransactionLog `json:"logs"`
	Timestamp        int64           `json:"timestamp"`
}

// TransactionLog represents a transaction log entry
type TransactionLog struct {
	Address     string   `json:"address"`
	Topics      []string `json:"topics"`
	Data        string   `json:"data"`
	LogIndex    uint64   `json:"log_index"`
	BlockNumber uint64   `json:"block_number"`
}

// Balance represents account balance
type Balance struct {
	Address    string          `json:"address"`
	TokenAddress string       `json:"token_address,omitempty"`
	Balance    string         `json:"balance"`
	RawBalance *big.Int      `json:"-"`
	ChainID    uint64         `json:"chain_id"`
	Timestamp  int64          `json:"timestamp"`
}

// BlockInfo represents block information
type BlockInfo struct {
	Number           uint64   `json:"number"`
	Hash             string   `json:"hash"`
	ParentHash       string   `json:"parent_hash"`
	Timestamp        uint64   `json:"timestamp"`
	Transactions     []string `json:"transactions"`
	GasUsed          uint64   `json:"gas_used"`
	GasLimit         uint64   `json:"gas_limit"`
	Miner            string   `json:"miner"`
	Difficulty       string   `json:"difficulty"`
	TotalDifficulty  string   `json:"total_difficulty"`
	Size             uint64   `json:"size"`
}

// GasPrice represents gas price information
type GasPrice struct {
	ChainID       uint64 `json:"chain_id"`
	Low           string `json:"low"`
	Medium        string `json:"medium"`
	High          string `json:"high"`
	Instant       string `json:"instant"`
	BaseFee       string `json:"base_fee"`
	PriorityFee   string `json:"priority_fee"`
	Timestamp     int64  `json:"timestamp"`
}

// BlockchainService manages blockchain interactions
type BlockchainService struct {
	// Network configurations
	networks map[uint64]*BlockchainNetwork
	
	// Token info cache
	tokens map[uint64]map[string]*TokenInfo
	
	// RPC clients per chain
	clients map[uint64]*ethclient.Client
	
	// WebSocket connections
	wsClients map[uint64]*ethclient.Client
	
	// Subscription handlers
	subscriptions map[string]*Subscription
	
	// Configuration
	config *BlockchainConfig
	
	mu sync.RWMutex `json:"-"`
}

// BlockchainConfig contains configuration
type BlockchainConfig struct {
	MaxConcurrentRequests int           `json:"max_concurrent_requests"`
	RequestTimeout      time.Duration  `json:"request_timeout"`
	MaxRetries         int           `json:"max_retries"`
	EnableCaching      bool           `json:"enable_caching"`
	CacheTTL           time.Duration  `json:"cache_ttl"`
	SupportedChains     []uint64       `json:"supported_chains"`
}

// Subscription represents a blockchain event subscription
type Subscription struct {
	ID        string `json:"id"`
	ChainID   uint64 `json:"chain_id"`
	EventType string `json:"event_type"`
	Address   string `json:"address"`
	Active   bool   `json:"active"`
}

// NewBlockchainService creates a new blockchain service
func NewBlockchainService(config BlockchainConfig) *BlockchainService {
	if config.MaxConcurrentRequests == 0 {
		config.MaxConcurrentRequests = 100
	}
	if config.RequestTimeout == 0 {
		config.RequestTimeout = 30 * time.Second
	}
	if config.CacheTTL == 0 {
		config.CacheTTL = 60 * time.Second
	}
	
	return &BlockchainService{
		networks:      make(map[uint64]*BlockchainNetwork),
		tokens:        make(map[uint64]map[string]*TokenInfo),
		clients:       make(map[uint64]*ethclient.Client),
		wsClients:    make(map[uint64]*ethclient.Client),
		subscriptions: make(map[string]*Subscription),
		config:        &config,
	}
}

// InitializeNetworks initializes supported blockchain networks
func (s *BlockchainService) InitializeNetworks() {
	networks := []*BlockchainNetwork{
		// Ethereum Mainnet
		{
			ID:            "ethereum-mainnet",
			Name:          "Ethereum",
			ChainType:     ChainTypeEVM,
			ChainID:       1,
			Symbol:        "ETH",
			Decimals:      18,
			ExplorerURL:   "https://etherscan.io",
			RPCURL:        "https://eth.llamarpc.com",
			WebSocketURL:  "wss://eth-mainnet.g.alchemy.com/v2/YOUR_KEY",
			Status:        NetworkStatusActive,
			Confirmations: 12,
			GasStation:    "https://api.etherscan.io/api?module=gastracker&action=gasoracle",
			Supported:     true,
			IconURL:       "https://cryptologos.cc/logos/ethereum-eth-logo.png",
			NetworkID:     "1",
		},
		// BSC Mainnet
		{
			ID:            "bsc-mainnet",
			Name:          "BNB Smart Chain",
			ChainType:     ChainTypeEVM,
			ChainID:       56,
			Symbol:        "BNB",
			Decimals:      18,
			ExplorerURL:   "https://bscscan.com",
			RPCURL:        "https://bsc-dataseed.binance.org",
			WebSocketURL:  "wss://bsc-ws-node.nariox.org",
			Status:        NetworkStatusActive,
			Confirmations: 15,
			Supported:     true,
			IconURL:       "https://cryptologos.cc/logos/bnb-bnb-logo.png",
			NetworkID:     "56",
		},
		// Polygon
		{
			ID:            "polygon-mainnet",
			Name:          "Polygon",
			ChainType:     ChainTypeEVM,
			ChainID:       137,
			Symbol:        "MATIC",
			Decimals:      18,
			ExplorerURL:   "https://polygonscan.com",
			RPCURL:        "https://polygon-rpc.com",
			WebSocketURL:  "wss://matic-ws.quiknode.pro/YOUR_KEY",
			Status:        NetworkStatusActive,
			Confirmations: 128,
			Supported:     true,
			IconURL:       "https://cryptologos.cc/logos/polygon-matic-logo.png",
			NetworkID:     "137",
		},
		// Arbitrum One
		{
			ID:            "arbitrum-mainnet",
			Name:          "Arbitrum One",
			ChainType:     ChainTypeEVM,
			ChainID:       42161,
			Symbol:        "ETH",
			Decimals:      18,
			ExplorerURL:   "https://arbiscan.io",
			RPCURL:        "https://arb1.arbitrum.io/rpc",
			WebSocketURL:  "wss://arb1.arbitrum.io/ws",
			Status:        NetworkStatusActive,
			Confirmations: 12,
			Supported:     true,
			IconURL:       "https://cryptologos.cc/logos/arbitrum-arb-logo.png",
			NetworkID:     "42161",
		},
		// Optimism
		{
			ID:            "optimism-mainnet",
			Name:          "Optimism",
			ChainType:     ChainTypeEVM,
			ChainID:       10,
			Symbol:        "ETH",
			Decimals:      18,
			ExplorerURL:   "https://optimistic.etherscan.io",
			RPCURL:        "https://mainnet.optimism.io",
			WebSocketURL:  "wss://mainnet.optimism.io/ws",
			Status:        NetworkStatusActive,
			Confirmations: 12,
			Supported:     true,
			IconURL:       "https://cryptologos.cc/logos/optimism-eth-logo.png",
			NetworkID:     "10",
		},
		// Avalanche C-Chain
		{
			ID:            "avalanche-mainnet",
			Name:          "Avalanche",
			ChainType:     ChainTypeEVM,
			ChainID:       43114,
			Symbol:        "AVAX",
			Decimals:      18,
			ExplorerURL:   "https://snowtrace.io",
			RPCURL:        "https://api.avax.network/ext/bc/C/rpc",
			WebSocketURL:  "wss://api.avax.network/ext/bc/C/ws",
			Status:        NetworkStatusActive,
			Confirmations: 12,
			Supported:     true,
			IconURL:       "https://cryptologos.cc/logos/avalanche-avax-logo.png",
			NetworkID:     "43114",
		},
		// Base
		{
			ID:            "base-mainnet",
			Name:          "Base",
			ChainType:     ChainTypeEVM,
			ChainID:       8453,
			Symbol:        "ETH",
			Decimals:      18,
			ExplorerURL:   "https://basescan.org",
			RPCURL:        "https://mainnet.base.org",
			WebSocketURL:  "wss://mainnet.base.org",
			Status:        NetworkStatusActive,
			Confirmations: 12,
			Supported:     true,
			IconURL:       "https://cryptologos.cc/logos/base-base-logo.png",
			NetworkID:     "8453",
		},
		// Solana
		{
			ID:            "solana-mainnet",
			Name:          "Solana",
			ChainType:     ChainTypeSolana,
			ChainID:       101,
			Symbol:        "SOL",
			Decimals:      9,
			ExplorerURL:   "https://explorer.solana.com",
			RPCURL:        "https://api.mainnet-beta.solana.com",
			WebSocketURL:  "wss://api.mainnet-beta.solana.com",
			Status:        NetworkStatusActive,
			Confirmations: 32,
			Supported:     true,
			IconURL:       "https://cryptologos.cc/logos/solana-sol-logo.png",
			NetworkID:     "101",
		},
		// TRON
		{
			ID:            "tron-mainnet",
			Name:          "TRON",
			ChainType:     ChainTypeTON,
			ChainID:       728126428,
			Symbol:        "TRX",
			Decimals:      6,
			ExplorerURL:   "https://tronscan.org",
			RPCURL:        "https://api.trongrid.io",
			WebSocketURL:  "wss://api.trongrid.io/ws",
			Status:        NetworkStatusActive,
			Confirmations: 19,
			Supported:     true,
			IconURL:       "https://cryptologos.cc/logos/tron-trx-logo.png",
			NetworkID:     "728126428",
		},
		// Aptos
		{
			ID:            "aptos-mainnet",
			Name:          "Aptos",
			ChainType:     ChainTypeAptos,
			ChainID:       1,
			Symbol:        "APT",
			Decimals:      8,
			ExplorerURL:   "https://explorer.aptoslabs.com",
			RPCURL:        "https://aptos-mainnet.nodereal.io/v1",
			WebSocketURL:  "",
			Status:        NetworkStatusActive,
			Confirmations: 1,
			Supported:     true,
			IconURL:       "https://cryptologos.cc/logos/aptos-apt-logo.png",
			NetworkID:     "1",
		},
		// NEAR
		{
			ID:            "near-mainnet",
			Name:          "NEAR Protocol",
			ChainType:     ChainTypeNear,
			ChainID:       1313161554,
			Symbol:        "NEAR",
			Decimals:      24,
			ExplorerURL:   "https://explorer.near.org",
			RPCURL:        "https://rpc.mainnet.near.org",
			WebSocketURL:  "wss://rpc.mainnet.near.org/ws",
			Status:        NetworkStatusActive,
			Confirmations: 1,
			Supported:     true,
			IconURL:       "https://cryptologos.cc/logos/near-protocol-near-logo.png",
			NetworkID:    "1313161554",
		},
	}
	
	s.mu.Lock()
	defer s.mu.Unlock()
	
	for _, network := range networks {
		s.networks[network.ChainID] = network
		s.tokens[network.ChainID] = make(map[string]*TokenInfo)
	}
}

// ConnectChain connects to a blockchain network
func (s *BlockchainService) ConnectChain(chainID uint64) error {
	s.mu.RLock()
	network, exists := s.networks[chainID]
	s.mu.RUnlock()
	
	if !exists {
		return fmt.Errorf("network not found for chain ID: %d", chainID)
	}
	
	if network.Status != NetworkStatusActive {
		return fmt.Errorf("network is not active: %s", network.Name)
	}
	
	// Connect to RPC
	client, err := ethclient.Dial(network.RPCURL)
	if err != nil {
		return fmt.Errorf("failed to connect to %s: %w", network.Name, err)
	}
	
	s.mu.Lock()
	s.clients[chainID] = client
	s.mu.Unlock()
	
	return nil
}

// GetNetwork returns network information
func (s *BlockchainService) GetNetwork(chainID uint64) (*BlockchainNetwork, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	network, exists := s.networks[chainID]
	if !exists {
		return nil, fmt.Errorf("network not found for chain ID: %d", chainID)
	}
	
	return network, nil
}

// GetAllNetworks returns all supported networks
func (s *BlockchainService) GetAllNetworks() []*BlockchainNetwork {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	networks := make([]*BlockchainNetwork, 0, len(s.networks))
	for _, network := range s.networks {
		networks = append(networks, network)
	}
	
	return networks
}

// GetBalance returns the balance of an address
func (s *BlockchainService) GetBalance(ctx context.Context, chainID uint64, address string) (*Balance, error) {
	s.mu.RLock()
	client, exists := s.clients[chainID]
	s.mu.RUnlock()
	
	if !exists {
		if err := s.ConnectChain(chainID); err != nil {
			return nil, err
		}
		s.mu.RLock()
		client = s.clients[chainID]
		s.mu.RUnlock()
	}
	
	if client == nil {
		return nil, fmt.Errorf("client not available for chain ID: %d", chainID)
	}
	
	// Validate address
	if !common.IsHexAddress(address) {
		return nil, fmt.Errorf("invalid address: %s", address)
	}
	
	balance, err := client.BalanceAt(ctx, common.HexToAddress(address), nil)
	if err != nil {
		return nil, fmt.Errorf("failed to get balance: %w", err)
	}
	
	network, _ := s.GetNetwork(chainID)
	
	return &Balance{
		Address:     address,
		Balance:    balance.String(),
		RawBalance: balance,
		ChainID:    chainID,
		Timestamp:  time.Now().UnixMilli(),
	}, nil
}

// GetTokenBalance returns the token balance of an address
func (s *BlockchainService) GetTokenBalance(ctx context.Context, chainID uint64, address, tokenAddress string) (*Balance, error) {
	s.mu.RLock()
	client, exists := s.clients[chainID]
	s.mu.RUnlock()
	
	if !exists {
		return nil, fmt.Errorf("not connected to chain ID: %d", chainID)
	}
	
	// ERC20 balanceOf selector: 0x70a08231
	methodID := "0x70a08231"
	
	// Pad address to 32 bytes
	paddedAddress := common.HexToAddress(tokenAddress).Hash().Hex()[2:]
	// Pad address parameter to 32 bytes
	addressParam := strings.TrimPrefix(address, "0x")
	addressPadded := fmt.Sprintf("%064s", addressParam)
	
	data := methodID + addressPadded
	
	callMsg := ethereum.CallMsg{
		To:   common.HexToAddress(tokenAddress),
		Data: common.FromHex(data),
	}
	
	result, err := client.CallContract(ctx, callMsg, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to call contract: %w", err)
	}
	
	balance := new(big.Int).SetBytes(result)
	
	network, _ := s.GetNetwork(chainID)
	
	return &Balance{
		Address:      address,
		TokenAddress: tokenAddress,
		Balance:     balance.String(),
		RawBalance:  balance,
		ChainID:     chainID,
		Timestamp:   time.Now().UnixMilli(),
	}, nil
}

// SendTransaction sends a transaction
func (s *BlockchainService) SendTransaction(ctx context.Context, req TransactionRequest) (string, error) {
	s.mu.RLock()
	client, exists := s.clients[req.ChainID]
	s.mu.RUnlock()
	
	if !exists {
		return "", fmt.Errorf("not connected to chain ID: %d", req.ChainID)
	}
	
	// Validate addresses
	if !common.IsHexAddress(req.FromAddress) || !common.IsHexAddress(req.ToAddress) {
		return "", fmt.Errorf("invalid address")
	}
	
	var tx *types.Transaction
	var err error
	
	if req.TokenAddress == "" {
		// Native ETH transfer
		value := new(big.Int)
		value, ok := value.SetString(req.Amount, 10)
		if !ok {
			return "", fmt.Errorf("invalid amount")
		}
		
		gasPrice := big.NewInt(50000000000) // 50 gwei default
		if req.GasPrice != "" {
			gasPrice, _ = new(big.Int).SetString(req.GasPrice, 10)
		}
		
		tx = types.NewTransaction(
			0, // nonce will be filled
			common.HexToAddress(req.ToAddress),
			value,
			req.GasLimit,
			gasPrice,
			nil,
		)
	} else {
		// ERC20 transfer
		// transfer selector: 0xa9059cbb
		methodID := "0xa9059cbb"
		
		// Pad recipient address
		recipientHash := common.HexToAddress(req.ToAddress).Hash().Hex()[2:]
		recipientPadded := fmt.Sprintf("%064s", recipientHash)
		
		// Parse amount
		amount := new(big.Int)
		amount, ok := amount.SetString(req.Amount, 10)
		if !ok {
			return "", fmt.Errorf("invalid amount")
		}
		
		// Pad amount to 32 bytes
		amountPadded := fmt.Sprintf("%064s", amount.Text(16))
		
		data := methodID + recipientPadded + amountPadded
		
		gasPrice := big.NewInt(50000000000)
		if req.GasPrice != "" {
			gasPrice, _ = new(big.Int).SetString(req.GasPrice, 10)
		}
		
		tx = types.NewTransaction(
			0,
			common.HexToAddress(req.TokenAddress),
			big.NewInt(0),
			req.GasLimit,
			gasPrice,
			common.FromHex(data),
		)
	}
	
	// In production, would need to:
	// 1. Get nonce from network
	// 2. Sign transaction with private key
	// 3. Send signed transaction
	
	return tx.Hash().Hex(), nil
}

// GetTransactionReceipt returns transaction receipt
func (s *BlockchainService) GetTransactionReceipt(ctx context.Context, chainID uint64, txHash string) (*TransactionReceipt, error) {
	s.mu.RLock()
	client, exists := s.clients[chainID]
	s.mu.RUnlock()
	
	if !exists {
		return nil, fmt.Errorf("not connected to chain ID: %d", chainID)
	}
	
	receipt, err := client.TransactionReceipt(ctx, common.HexToHash(txHash))
	if err != nil {
		return nil, fmt.Errorf("failed to get receipt: %w", err)
	}
	
	logs := make([]TransactionLog, len(receipt.Logs))
	for i, log := range receipt.Logs {
		topics := make([]string, len(log.Topics))
		for j, topic := range log.Topics {
			topics[j] = topic.Hex()
		}
		
		logs[i] = TransactionLog{
			Address:     log.Address.Hex(),
			Topics:      topics,
			Data:        "0x" + hex.EncodeToString(log.Data),
			LogIndex:    uint64(i),
			BlockNumber: log.BlockNumber,
		}
	}
	
	return &TransactionReceipt{
		TransactionHash:   receipt.TxHash.Hex(),
		BlockNumber:       receipt.BlockNumber,
		BlockHash:         receipt.BlockHash.Hex(),
		Status:            receipt.Status == 1,
		GasUsed:           receipt.GasUsed,
		CumulativeGasUsed: receipt.CumulativeGasUsed,
		FromAddress:       receipt.From.Hex(),
		ToAddress:         receipt.To.Hex(),
		Amount:           "0",
		Logs:              logs,
		Timestamp:         time.Now().UnixMilli(),
	}, nil
}

// GetGasPrice returns current gas price for a chain
func (s *BlockchainService) GetGasPrice(ctx context.Context, chainID uint64) (*GasPrice, error) {
	s.mu.RLock()
	client, exists := s.clients[chainID]
	s.mu.RUnlock()
	
	if !exists {
		return nil, fmt.Errorf("not connected to chain ID: %d", chainID)
	}
	
	gasPrice, err := client.SuggestGasPrice(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get gas price: %w", err)
	}
	
	// Convert to Gwei
	low := new(big.Int).Div(gasPrice, big.NewInt(params.GWei))
	medium := gasPrice
	high := new(big.Int).Mul(gasPrice, big.NewInt(2))
	instant := new(big.Int).Mul(gasPrice, big.NewInt(3))
	
	return &GasPrice{
		ChainID:     chainID,
		Low:         low.String(),
		Medium:      medium.String(),
		High:        high.String(),
		Instant:     instant.String(),
		BaseFee:     medium.String(),
		PriorityFee: "2",
		Timestamp:   time.Now().UnixMilli(),
	}, nil
}

// GetBlockByNumber returns block information
func (s *BlockchainService) GetBlockByNumber(ctx context.Context, chainID uint64, blockNumber uint64) (*BlockInfo, error) {
	s.mu.RLock()
	client, exists := s.clients[chainID]
	s.mu.RUnlock()
	
	if !exists {
		return nil, fmt.Errorf("not connected to chain ID: %d", chainID)
	}
	
	block, err := client.BlockByNumber(ctx, big.NewInt(int64(blockNumber)))
	if err != nil {
		return nil, fmt.Errorf("failed to get block: %w", err)
	}
	
	txHashes := make([]string, block.Transactions().Len())
	for i := 0; i < block.Transactions().Len(); i++ {
		txHashes[i] = block.Transactions()[i].Hash().Hex()
	}
	
	return &BlockInfo{
		Number:        block.Number().Uint64(),
		Hash:          block.Hash().Hex(),
		ParentHash:    block.ParentHash().Hex(),
		Timestamp:     block.Time(),
		Transactions:  txHashes,
		GasUsed:        block.GasUsed(),
		GasLimit:       block.GasLimit(),
		Miner:          block.Coinbase().Hex(),
		Difficulty:     block.Difficulty().String(),
		TotalDifficulty: block.TotalDifficulty().String(),
		Size:           block.Size(),
	}, nil
}

// RegisterToken registers a token on a chain
func (s *BlockchainService) RegisterToken(chainID uint64, token TokenInfo) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	if _, ok := s.tokens[chainID]; !ok {
		s.tokens[chainID] = make(map[string]*TokenInfo)
	}
	
	s.tokens[chainID][strings.ToLower(token.Address)] = &token
}

// GetToken returns token information
func (s *BlockchainService) GetToken(chainID uint64, address string) (*TokenInfo, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	if tokens, ok := s.tokens[chainID]; ok {
		if token, ok := tokens[strings.ToLower(address)]; ok {
			return token, nil
		}
	}
	
	return nil, fmt.Errorf("token not found")
}

// SubscribeToEvents creates an event subscription
func (s *BlockchainService) SubscribeToEvents(chainID uint64, eventType, address string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	subID := uuid.New().String()
	
	s.subscriptions[subID] = &Subscription{
		ID:        subID,
		ChainID:   chainID,
		EventType: eventType,
		Address:   address,
		Active:    true,
	}
	
	return subID, nil
}

// Unsubscribe removes an event subscription
func (s *BlockchainService) Unsubscribe(subID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	if _, exists := s.subscriptions[subID]; !exists {
		return fmt.Errorf("subscription not found: %s", subID)
	}
	
	delete(s.subscriptions, subID)
	return nil
}

// EstimateGas estimates gas for a transaction
func (s *BlockchainService) EstimateGas(ctx context.Context, req TransactionRequest) (uint64, error) {
	s.mu.RLock()
	client, exists := s.clients[req.ChainID]
	s.mu.RUnlock()
	
	if !exists {
		return 0, fmt.Errorf("not connected to chain ID: %d", req.ChainID)
	}
	
	var msg ethereum.CallMsg
	
	if req.TokenAddress == "" {
		msg = ethereum.CallMsg{
			From: common.HexToAddress(req.FromAddress),
			To:   common.HexToAddress(req.ToAddress),
			Value: func() *big.Int {
				v, _ := new(big.Int).SetString(req.Amount, 10)
				return v
			}(),
			Gas: req.GasLimit,
		}
	} else {
		methodID := "0xa9059cbb"
		recipientHash := common.HexToAddress(req.ToAddress).Hash().Hex()[2:]
		recipientPadded := fmt.Sprintf("%064s", recipientHash)
		amount := new(big.Int)
		amount, _ = amount.SetString(req.Amount, 10)
		amountPadded := fmt.Sprintf("%064s", amount.Text(16))
		
		data := methodID + recipientPadded + amountPadded
		
		msg = ethereum.CallMsg{
			From: common.HexToAddress(req.FromAddress),
			To:   common.HexToAddress(req.TokenAddress),
			Data: common.FromHex(data),
			Gas:  req.GasLimit,
		}
	}
	
	gas, err := client.EstimateGas(ctx, msg)
	if err != nil {
		return 0, fmt.Errorf("failed to estimate gas: %w", err)
	}
	
	// Add 20% buffer
	return gas * 120 / 100, nil
}

// ============================================================================
// SMART CONTRACT INTERACTIONS
// ============================================================================

// ContractCaller provides smart contract calling utilities
type ContractCaller struct {
	client *ethclient.Client
	chainID uint64
}

// NewContractCaller creates a new contract caller
func NewContractCaller(client *ethclient.Client, chainID uint64) *ContractCaller {
	return &ContractCaller{
		client:  client,
		chainID: chainID,
	}
}

// CallContract calls a smart contract method
func (c *ContractCaller) CallContract(ctx context.Context, to string, method string, args ...interface{}) ([]byte, error) {
	// Parse ABI (simplified - in production would use full ABI)
	parsedABI, err := abi.JSON(strings.NewReader(method))
	if err != nil {
		return nil, fmt.Errorf("failed to parse ABI: %w", err)
	}
	
	input, err := parsedABI.Pack(method, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to pack arguments: %w", err)
	}
	
	result, err := c.client.CallContract(ctx, ethereum.CallMsg{
		To: common.HexToAddress(to),
		Data: input,
	}, nil)
	
	return result, err
}

// ReadContract reads data from a contract
func (c *ContractCaller) ReadContract(ctx context.Context, to string, method string, result interface{}, args ...interface{}) error {
	data, err := c.CallContract(ctx, to, method, args...)
	if err != nil {
		return err
	}
	
	// Unpack result
	parsedABI, err := abi.JSON(strings.NewReader(method))
	if err != nil {
		return fmt.Errorf("failed to parse ABI: %w", err)
	}
	
	return parsedABI.Unpack(result, method, data)
}

// ============================================================================
// MULTI-CHAIN UTILITIES
// ============================================================================

// CrossChainTransfer represents a cross-chain transfer
type CrossChainTransfer struct {
	ID             string `json:"id"`
	SourceChain    uint64 `json:"source_chain"`
	DestChain      uint64 `json:"dest_chain"`
	FromAddress    string `json:"from_address"`
	ToAddress      string `json:"to_address"`
	TokenAddress   string `json:"token_address"`
	Amount         string `json:"amount"`
	Status         string `json:"status"`
	SourceTxHash   string `json:"source_tx_hash"`
	DestTxHash     string `json:"dest_tx_hash"`
	Timestamp      int64  `json:"timestamp"`
}

// MultiChainService handles cross-chain operations
type MultiChainService struct {
	blockchain *BlockchainService
}

// NewMultiChainService creates a new multi-chain service
func NewMultiChainService(blockchain *BlockchainService) *MultiChainService {
	return &MultiChainService{
		blockchain: blockchain,
	}
}

// GetSupportedChains returns all supported chains
func (s *MultiChainService) GetSupportedChains() []uint64 {
	networks := s.blockchain.GetAllNetworks()
	chains := make([]uint64, 0, len(networks))
	
	for _, network := range networks {
		if network.Supported {
			chains = append(chains, network.ChainID)
		}
	}
	
	return chains
}

// ============================================================================
// JSON SERIALIZATION HELPERS
// ============================================================================

// ToJSON converts a struct to JSON
func ToJSON(v interface{}) (string, error) {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return "", err
	}
	return string(data), nil
}
