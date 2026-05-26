// Package options_trading provides options trading services.
// European/American options, Greeks calculation.
package main

import (
	"fmt"
	"math"
	"sync"
	"time"
)

// Option Contract
type OptionContract struct {
	ID          string  `json:"id"`
	Underlying string  `json:"underlying"`
	Strike    float64 `json:"strike"`
	Expiry   int64   `json:"expiry"`
	Type     string  `json:"type"` // call, put
	Style    string  `json:"style"` // european, american
	Volume   float64 `json:"volume"`
	OpenInterest float64 `json:"openInterest"`
	Status    string  `json:"status"` // trading, expired, settled
}

// Option Position
type OptionPosition struct {
	ID        string  `json:"id"`
	UserID   string  `json:"userId"`
	ContractID string `json:"contractId"`
	Side     string  `json:"side"` // long, short
	Size     float64 `json:"size"`
	EntryPrice float64 `json:"entryPrice"`
	PnL      float64 `json:"pnl"`
}

// Greeks
type Greeks struct {
	Delta float64 `json:"delta"`
	Gamma float64 `json:"gamma"`
	Theta float64 `json:"theta"`
	Vega  float64 `json:"vega"`
	Rho   float64 `json:"rho"`
}

// Option Chain
type OptionChain struct {
	Underlying string    `json:"underlying"`
	Expiry    int64      `json:"expiry"`
	Calls    []float64  `json:"calls"` // strike prices
	Puts     []float64  `json:"puts"`
}

// Store
type OptStore struct {
	mu       sync.RWMutex
	contracts map[string]*OptionContract
	positions map[string]*OptionPosition
 chains    map[string]*OptionChain
}

var optStore = &OptStore{
	contracts: make(map[string]*OptionContract),
	positions: make(map[string]*OptionPosition),
	chains: make(map[string]*OptionChain),
}

// Create option contract
func CreateOption(underlying string, strike float64, expiry int64, optType, style string) *OptionContract {
	contract := &OptionContract{
		ID: fmt.Sprintf("opt_%d", time.Now().UnixNano()),
		Underlying: underlying,
		Strike: strike,
		Expiry: expiry,
		Type: optType,
		Style: style,
		Volume: 0,
		OpenInterest: 0,
		Status: "trading",
	}

	optStore.mu.Lock()
	optStore.contracts[contract.ID] = contract
	optStore.mu.Unlock()

	return contract
}

// Buy option
func BuyOption(userID, contractID string, size float64, price float64) *OptionPosition {
	position := &OptionPosition{
		ID: fmt.Sprintf("pos_%d", time.Now().UnixNano()),
		UserID: userID,
		ContractID: contractID,
		Side: "long",
		Size: size,
		EntryPrice: price,
		PnL: 0,
	}

	optStore.mu.Lock()
	optStore.positions[position.ID] = position
	optStore.mu.Unlock()

	return position
}

// Calculate Black-Scholes
func BlackScholes(S, K, T, r, sigma float64, optType string) float64 {
	// S: underlying price, K: strike, T: time to expiry (years), r: risk-free rate, sigma: volatility

	d1 := (math.Log(S/K) + (r + sigma*sigma/2)*T) / (sigma * math.Sqrt(T))
	d2 := d1 - sigma*math.Sqrt(T)

	if optType == "call" {
		return S*CND(d1) - K*math.Exp(-r*T)*CND(d2)
	}
	return K*math.Exp(-r*T)*CND(-d2) - S*CND(-d1)
}

// Calculate Greeks
func CalculateGreeks(S, K, T, r, sigma float64, optType string) *Greeks {
	d1 := (math.Log(S/K) + (r+sigma*sigma/2)*T) / (sigma * math.Sqrt(T))
	d2 := d1 - sigma*math.Sqrt(T)

	nd1 := CND(d1)
	nd2 := CND(d2)

	delta := nd1
	if optType == "put" {
		delta = nd1 - 1
	}

gamma := nd1 / (S * sigma * math.Sqrt(T))

	theta := -(S*ND(d1)*sigma)/(2*math.Sqrt(T)) - r*K*math.Exp(-r*T)*nd2
	if optType == "put" {
		theta = -(S*ND(d1)*sigma)/(2*math.Sqrt(T)) + r*K*math.Exp(-r*T)*nd2
	}
	theta /= 365 // Daily

vega := S * math.Sqrt(T) * ND(d1) / 100

	rho := K * T * math.Exp(-r*T) * nd2
	if optType == "put" {
		rho = -K * T * math.Exp(-r*T) * CND(-d2)
	}
	rho /= 100

	return &Greeks{
		Delta: delta,
		Gamma: gamma,
		Theta: theta,
		Vega: vega,
		Rho: rho,
	}
}

// Expire options
func ExpireOptions(expiry int64) {
	optStore.mu.RLock()
	var toExpire []string
	for id, c := range optStore.contracts {
		if c.Expiry <= expiry && c.Status == "trading" {
			toExpire = append(toExpire, id)
		}
	}
	optStore.mu.RUnlock()

	optStore.mu.Lock()
	for _, id := range toExpire {
		optStore.contracts[id].Status = "expired"
	}
	optStore.mu.Unlock()
}

// Settle option
func SettleOption(positionID string, settlePrice float64) error {
	optStore.mu.RLock()
	position, ok := optStore.positions[positionID]
	optStore.mu.RUnlock()

	if !ok {
		return fmt.Errorf("position not found")
	}

	optStore.mu.RLock()
	contract, cok := optStore.contracts[position.ContractID]
	optStore.mu.RUnlock()

	if !cok {
		return fmt.Errorf("contract not found")
	}

	pnl := 0.0
	if contract.Type == "call" {
		pnl = (settlePrice - contract.Strike) * position.Size
		if pnl < 0 {
			pnl = 0
		}
	} else {
		pnl = (contract.Strike - settlePrice) * position.Size
		if pnl < 0 {
			pnl = 0
		}
	}

	optStore.mu.Lock()
	position.PnL = pnl
	optStore.mu.Unlock()

	return nil
}

func CND(x float64) float64 {
	return 0.5 * (1 + math.Erf(x/math.Sqrt(2)))
}

func ND(x float64) float64 {
	return math.Exp(-0.5*x*x) / math.Sqrt(2*math.Pi)
}

func main() {
	fmt.Println("Options Trading service initialized")

	// Create contract
	contract := CreateOption("BTCUSDT", 70000, time.Now().UnixMilli()+86400000*30, "call", "european")
	fmt.Printf("Contract: %s Strike: %.0f\n", contract.ID, contract.Strike)

	// Greeks
	greeks := CalculateGreeks(65000, 70000, 0.083, 0.05, 1.0, "call")
	fmt.Printf("Delta: %.4f Gamma: %.4f\n", greeks.Delta, greeks.Gamma)
}