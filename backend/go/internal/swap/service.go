package swap

import (
	"context"
	"errors"
	"math/big"
	"time"

	"github.com/google/uuid"
)

var (
	ErrInsufficientLiquidity = errors.New("insufficient liquidity")
	ErrInsufficientBalance  = errors.New("insufficient balance")
	ErrInvalidPath          = errors.New("invalid swap path")
	ErrSlippageExceeded    = errors.New("slippage exceeded")
	ErrSwapFailed           = errors.New("swap failed")
)

// SwapType represents type of swap
type SwapType string

const (
	SwapTypeExactIn  SwapType = "exact_in"  // Swap exact amount of input token
	SwapTypeExactOut SwapType = "exact_out" // Swap for exact amount of output token
)

// SwapRequest represents a swap request
type SwapRequest struct {
	UserID       uuid.UUID
	FromToken    string
	ToToken      string
	FromAmount   *big.Int
	ToAmount    *big.Int
	MinToAmount  *big.Int
	SwapType     SwapType
	Slippage     float64 // percentage, e.g., 0.5 = 0.5%
	Blockchain   string
	Provider    string // "uniswap", "pancakeswap", "1inch", "native"
}

// SwapResult represents result of a swap
type SwapResult struct {
	ID              uuid.UUID
	UserID          uuid.UUID
	FromToken       string
	ToToken         string
	FromAmount      *big.Int
	ToAmount        *big.Int
	Rate            *big.Int
	FeeAmount       *big.Int
	FeeToken        string
	TxHash          string
	Status          string
	Provider        string
	ExecutedAt      time.Time
}

// LiquidityPool represents a liquidity pool
type LiquidityPool struct {
	ID           uuid.UUID
	Token0       string
	Token1       string
	Reserve0     *big.Int
	Reserve1     *big.Int
	Liquidity    *big.Int
	Blockchain   string
	Provider     string // DEX name
	PoolAddress  string
	FeeTier      int // e.g., 3000 = 0.3%
}

// Route represents a swap route
type Route struct {
	Path       []string
	PathTokens []Token
	Reserves   []*big.Int
	Providers  []string
}

// Token represents a token
type Token struct {
	Address     string
	Symbol      string
	Name        string
	Decimals    int
	ChainID     int64
	IsNative    bool
}

// Service handles swap operations
type Service struct {
	pools        map[string]*LiquidityPool
	feeCollector *big.Int
}

// NewService creates a new swap service
func NewService() *Service {
	return &Service{
		pools:        make(map[string]*LiquidityPool),
		feeCollector: big.NewInt(0),
	}
}

// AddLiquidityPool adds a liquidity pool
func (s *Service) AddLiquidityPool(ctx context.Context, pool *LiquidityPool) error {
	poolKey := s.getPoolKey(pool.Token0, pool.Token1, pool.Blockchain, pool.Provider)
	pool.ID = uuid.New()
	s.pools[poolKey] = pool
	return nil
}

// InitializePools creates default pools for popular pairs
func (s *Service) InitializePools() {
	// ETH pairs
	s.addPool("WETH", "USDT", "ethereum", "uniswap", "0x88e6A0c2d26E9E7B8Bf4E1B9D72B1E2B5d4a5c6d7", 3000, "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D")
	s.addPool("WETH", "USDC", "ethereum", "uniswap", "0x88e6A0c2d26E9E7B8Bf4E1B9D72B1E2B5d4a5c6d7", 3000, "0x88e6A0c2d26E9E7B8Bf4E1B9D72B1E2B5d4a5c6d7")
	s.addPool("WETH", "WBTC", "ethereum", "uniswap", "0x88e6A0c2d26E9E7B8Bf4E1B9D72B1E2B5d4a5c6d7", 3000, "0x88e6A0c2d26E9E7B8Bf4E1B9D72B1E2B5d4a5c6d7")
	
	// BSC pairs
	s.addPool("WBNB", "USDT", "bsc", "pancakeswap", "0x10ED43C718714eb63d5aA57B78B54704E3840247A", 2500, "0x16b9a17C7A3f5f5B5D5e5D5c5f5D5C5F5d5c5f")
	s.addPool("WBNB", "BUSD", "bsc", "pancakeswap", "0x10ED43C718714eb63d5aA57B78B54704E3840247A", 2500, "0x16b9a17C7A3f5f5B5D5e5D5c5f5B5D5c5f5d")
	
	// Polygon
	s.addPool("WMATIC", "USDT", "polygon", "quickswap", "0xa5E0829CaCEd8fFD7DEa7C8EeEB48aDaDa1C8D47", 3000, "0x16b9a17C7A3f5f5B5D5e5D5c5f5B5D5c5f5d")
	
	// Arbitrum
	s.addPool("WETH", "USDT", "arbitrum", "uniswap", "0xE592427A0AEce92De3Edee8F7020e1c10C4f1EAd", 3000, "0x16b9a17C7A3f5f5B5D5e5D5c5f5B5D5c5f5d")
	
	// Avalanche
	s.addPool("WAVAX", "USDT", "avalanche", "traderjoe", "0xE3FbE1E1f5D5D5D5D5D5D5D5D5D5D5D5D5D5D5D5D5D5D", 3000, "0x16b9a17C7A3f5f5B5D5e5D5c5f5B5D5c5f5d")
}

func (s *Service) addPool(token0, token1, blockchain, provider, poolAddr string, feeTier int, routerAddr string) {
	pool := &LiquidityPool{
		ID:          uuid.New(),
		Token0:     token0,
		Token1:     token1,
		Reserve0:    big.NewInt(1000000000000000000), // Mock reserves
		Reserve1:    big.NewInt(1000000000000000000),
		Liquidity:   big.NewInt(1000000000000000000),
		Blockchain:  blockchain,
		Provider:    provider,
		PoolAddress: poolAddr,
		FeeTier:     feeTier,
	}
	poolKey := s.getPoolKey(token0, token1, blockchain, provider)
	s.pools[poolKey] = pool
}

func (s *Service) getPoolKey(token0, token1, blockchain, provider string) string {
	return token0 + "_" + token1 + "_" + blockchain + "_" + provider
}

// GetQuote returns swap quote
func (s *Service) GetQuote(ctx context.Context, req *SwapRequest) (*SwapResult, error) {
	// Calculate output amount based on reserves
	// This is a simplified AMM formula: output = (input * reserveOut * 999) / (reserveIn * 1000 + input * 999)
	
	poolKey := s.getPoolKey(req.FromToken, req.ToToken, req.Blockchain, req.Provider)
	pool, ok := s.pools[poolKey]
	
	if !ok {
		// Try multi-hop swap
		return s.getMultiHopQuote(ctx, req)
	}

	var outputAmount *big.Int
	
	if req.SwapType == SwapTypeExactIn {
		// Exact input: calculate output
		inputWithFee := new(big.Int).Mul(req.FromAmount, big.NewInt(997))
		numerator := new(big.Int).Mul(inputWithFee, pool.Reserve1)
		denominator := new(big.Int).Add(new(big.Int).Mul(pool.Reserve0, big.NewInt(1000)), inputWithFee)
		outputAmount = new(big.Int).Div(numerator, denominator)
	} else {
		// Exact output: calculate input
		outputAmount = req.ToAmount
	}

	// Apply slippage
	minOutput := new(big.Int).Mul(outputAmount, big.NewInt(10000-int64(req.Slippage*100)))
	minOutput = new(big.Int).Div(minOutput, big.NewInt(10000))

	req.MinToAmount = minOutput

	// Calculate rate
	rate := new(big.Int).Mul(outputAmount, big.NewInt(1e8))
	rate = new(big.Int).Div(rate, req.FromAmount)

	// Calculate fee (0.3%)
	feeAmount := new(big.Int).Mul(req.FromAmount, big.NewInt(3))
	feeAmount = new(big.Int).Div(feeAmount, big.NewInt(1000))

	result := &SwapResult{
		ID:           uuid.New(),
		UserID:       req.UserID,
		FromToken:    req.FromToken,
		ToToken:      req.ToToken,
		FromAmount:   req.FromAmount,
		ToAmount:     outputAmount,
		Rate:         rate,
		FeeAmount:    feeAmount,
		FeeToken:     req.FromToken,
		Status:       "pending",
		Provider:     req.Provider,
		ExecutedAt:   time.Now(),
	}

	return result, nil
}

// getMultiHopQuote calculates quote for multi-hop swap
func (s *Service) getMultiHopQuote(ctx context.Context, req *SwapRequest) (*SwapResult, error) {
	// Simplified: just return a mock quote
	// In production, would find intermediate pools
	
	outputAmount := new(big.Int).Mul(req.FromAmount, big.NewInt(1))
	
	result := &SwapResult{
		ID:         uuid.New(),
		UserID:     req.UserID,
		FromToken:  req.FromToken,
		ToToken:    req.ToToken,
		FromAmount: req.FromAmount,
		ToAmount:   outputAmount,
		Rate:       big.NewInt(1e8),
		Status:     "pending",
		Provider:   "multi-hop",
	}

	return result, nil
}

// ExecuteSwap executes a swap
func (s *Service) ExecuteSwap(ctx context.Context, req *SwapRequest) (*SwapResult, error) {
	// Get quote first
	result, err := s.GetQuote(ctx, req)
	if err != nil {
		return nil, err
	}

	// Check slippage
	if result.ToAmount.Cmp(req.MinToAmount) < 0 {
		return nil, ErrSlippageExceeded
	}

	// In production, would:
	// 1. Deduct from user's wallet
	// 2. Call DEX router contract
	// 3. Receive tokens
	// 4. Credit to user's wallet
	// 5. Collect fees

	// Mock transaction
	txHash := "0x" + uuid.New().String()
	result.TxHash = txHash
	result.Status = "completed"
	
	// Collect fees
	s.feeCollector.Add(s.feeCollector, result.FeeAmount)

	return result, nil
}

// GetPool returns pool info
func (s *Service) GetPool(ctx context.Context, token0, token1, blockchain, provider string) (*LiquidityPool, error) {
	poolKey := s.getPoolKey(token0, token1, blockchain, provider)
	pool, ok := s.pools[poolKey]
	if !ok {
		return nil, ErrInsufficientLiquidity
	}
	return pool, nil
}

// GetPoolsForToken returns all pools containing a token
func (s *Service) GetPoolsForToken(ctx context.Context, token, blockchain string) ([]LiquidityPool, error) {
	pools := make([]LiquidityPool, 0)
	for _, p := range s.pools {
		if (p.Token0 == token || p.Token1 == token) && p.Blockchain == blockchain {
			pools = append(pools, *p)
		}
	}
	return pools, nil
}

// GetAllPools returns all pools
func (s *Service) GetAllPools(ctx context.Context) ([]LiquidityPool, error) {
	pools := make([]LiquidityPool, 0, len(s.pools))
	for _, p := range s.pools {
		pools = append(pools, *p)
	}
	return pools, nil
}

// GetCollectedFees returns total collected fees
func (s *Service) GetCollectedFees(ctx context.Context) *big.Int {
	return s.feeCollector
}

// AddLiquidity adds liquidity to a pool
func (s *Service) AddLiquidity(ctx context.Context, userID uuid.UUID, token0, token1 string, amount0, amount1 *big.Int, blockchain, provider string) (*LiquidityPool, error) {
	poolKey := s.getPoolKey(token0, token1, blockchain, provider)
	pool, ok := s.pools[poolKey]
	
	if !ok {
		pool = &LiquidityPool{
			ID:          uuid.New(),
			Token0:      token0,
			Token1:      token1,
			Blockchain:  blockchain,
			Provider:    provider,
			FeeTier:     3000,
		}
		s.pools[poolKey] = pool
	}

	// Calculate liquidity tokens to mint
	liquidity := new(big.Int).Mul(amount0, amount1)
	liquidity = new(big.Int).Sqrt(liquidity)

	pool.Reserve0.Add(pool.Reserve0, amount0)
	pool.Reserve1.Add(pool.Reserve1, amount1)
	pool.Liquidity.Add(pool.Liquidity, liquidity)

	return pool, nil
}

// RemoveLiquidity removes liquidity from a pool
func (s *Service) RemoveLiquidity(ctx context.Context, userID uuid.UUID, poolID uuid.UUID, liquidity *big.Int) (*big.Int, *big.Int, error) {
	// Find pool
	var pool *LiquidityPool
	for _, p := range s.pools {
		if p.ID == poolID {
			pool = p
			break
		}
	}

	if pool == nil {
		return nil, nil, ErrInsufficientLiquidity
	}

	// Calculate amounts to return
	ratio := new(big.Float).SetInt(liquidity)
	ratio = new(big.Float).Quo(ratio, new(big.Float).SetInt(pool.Liquidity))
	
	amount0 := new(big.Int).Mul(pool.Reserve0, new(big.Int).SetFloat64(ratio.Float64()))
	amount1 := new(big.Int).Mul(pool.Reserve1, new(big.Int).SetFloat64(ratio.Float64()))

	pool.Liquidity.Sub(pool.Liquidity, liquidity)
	pool.Reserve0.Sub(pool.Reserve0, amount0)
	pool.Reserve1.Sub(pool.Reserve1, amount1)

	return amount0, amount1, nil
}
