// TigerEx CEX Trading System
// Built with Go for high-load worldwide distributed systems

package main

import (
	"context"
	"fmt"
	"math/big"
	"sync"
	"time"
)

// =============================================================================
// TYPES
// =============================================================================

// User represents a CEX user
type User struct {
	ID                string
	Email             string
	Username          string
	Status            string
	KYCLevel          int
	TwoFactorEnabled  bool
	CreatedAt         time.Time
	Wallets           map[string]*Wallet
}

// Wallet represents user wallet
type Wallet struct {
	UserID    string
	Currency  string
	Balance   *big.Float
	Locked    *big.Float
}

// Order represents a trading order
type Order struct {
	ID            string
	UserID        string
	Symbol        string
	Side          string
	Type          string
	Quantity      *big.Float
	Price         *big.Float
	Filled        *big.Float
	Status        string
	CreatedAt     time.Time
}

// Trade represents a trade
type Trade struct {
	ID        string
	OrderID   string
	Symbol    string
	Side      string
	Price     *big.Float
	Quantity  *big.Float
	Fee       *big.Float
	Timestamp time.Time
}

// Market represents a trading market
type Market struct {
	Symbol         string
	BaseCurrency   string
	QuoteCurrency  string
	Price          *big.Float
	Volume24h     *big.Float
	High24h       *big.Float
	Low24h        *big.Float
	Status        string
	MakerFee      *big.Float
	TakerFee      *big.Float
}

// Position represents a futures position
type Position struct {
	ID            string
	UserID        string
	Symbol        string
	Side          string
	Quantity      *big.Float
	EntryPrice    *big.Float
	Leverage      int
	LiquidationPrice *big.Float
	Margin        *big.Float
	UnrealizedPNL *big.Float
}

// P2PTrade represents P2P trade
type P2PTrade struct {
	ID          string
	Advertiser  string
	Side        string
	Currency    string
	Amount      *big.Float
	Price       *big.Float
	PaymentMethod string
	Status      string
}

// =============================================================================
// CEX SERVICE
// =============================================================================

// CEXService handles all CEX trading operations
type CEXService struct {
	mu          sync.RWMutex
	users       map[string]*User
	orders      map[string]*Order
	trades      map[string]*Trade
	markets     map[string]*Market
	positions   map[string]*Position
	p2pTrades   map[string]*P2PTrade
	orderID     int64
	tradeID     int64
}

// NewCEXService creates new CEX service
func NewCEXService() *CEXService {
	svc := &CEXService{
		users:     make(map[string]*User),
		orders:    make(map[string]*Order),
		trades:    make(map[string]*Trade),
		markets:   make(map[string]*Market),
		positions: make(map[string]*Position),
		p2pTrades: make(map[string]*P2PTrade),
	}
	
	svc.initMarkets()
	return svc
}

func (s *CEXService) initMarkets() {
	// Spot markets
	markets := []struct {
		symbol, base, quote string
		price               float64
	}{
		{"BTC/USDT", "BTC", "USDT", 50000},
		{"ETH/USDT", "ETH", "USDT", 2500},
		{"BNB/USDT", "BNB", "USDT", 350},
		{"SOL/USDT", "SOL", "USDT", 100},
		{"XRP/USDT", "XRP", "USDT", 0.5},
		{"DOGE/USDT", "DOGE", "USDT", 0.08},
		{"ADA/USDT", "ADA", "USDT", 0.35},
		{"AVAX/USDT", "AVAX", "USDT", 35},
		{"DOT/USDT", "DOT", "USDT", 7},
		{"MATIC/USDT", "MATIC", "USDT", 0.5},
		{"LINK/USDT", "LINK", "USDT", 15},
		{"UNI/USDT", "UNI", "USDT", 7},
		{"ATOM/USDT", "ATOM", "USDT", 9},
		{"LTC/USDT", "LTC", "USDT", 70},
		{"BCH/USDT", "BCH", "USDT", 250},
		{"TRX/USDT", "TRX", "USDT", 0.1},
		{"USDC/USDT", "USDC", "USDT", 1},
		{"PAXG/USDT", "PAXG", "USDT", 1950},
	}
	
	for _, m := range markets {
		s.markets[m.symbol] = &Market{
			Symbol: m.symbol, BaseCurrency: m.base, QuoteCurrency: m.quote,
			Price: big.NewFloat(m.price), Volume24h: big.NewFloat(0),
			High24h: big.NewFloat(m.price * 1.02), Low24h: big.NewFloat(m.price * 0.98),
			Status: "ACTIVE", MakerFee: big.NewFloat(0.001), TakerFee: big.NewFloat(0.001),
		}
	}
	
	// Futures markets
	futures := []string{"BTC-USDT-PERP", "ETH-USDT-PERP", "BNB-USDT-PERP", "SOL-USDT-PERP"}
	for _, f := range futures {
		s.markets[f] = &Market{
			Symbol: f, BaseCurrency: "PERP", QuoteCurrency: "USDT",
			Price: big.NewFloat(50000), Volume24h: big.NewFloat(0),
			Status: "ACTIVE", MakerFee: big.NewFloat(0.0001), TakerFee: big.NewFloat(0.0005),
		}
	}
}

// CreateUser creates a new user
func (s *CEXService) CreateUser(email, username string) *User {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	user := &User{
		ID: fmt.Sprintf("USER_%d", time.Now().UnixNano()),
		Email: email,
		Username: username,
		Status: "ACTIVE",
		KYCLevel: 0,
		TwoFactorEnabled: false,
		CreatedAt: time.Now(),
		Wallets: make(map[string]*Wallet),
	}
	
	// Create wallets for supported currencies
	currencies := []string{"USDT", "BTC", "ETH", "BNB", "SOL", "XRP", "DOGE", "ADA", "AVAX", "DOT", "MATIC", "LINK", "UNI", "ATOM", "LTC", "BCH", "TRX", "USDC", "PAXG"}
	for _, c := range currencies {
		user.Wallets[c] = &Wallet{
			UserID: user.ID, Currency: c,
			Balance: big.NewFloat(0), Locked: big.NewFloat(0),
		}
	}
	
	s.users[user.ID] = user
	return user
}

// CreateOrder creates a new order
func (s *CEXService) CreateOrder(userID, symbol, side, orderType string, quantity, price *big.Float) (*Order, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	// Verify market exists
	if _, ok := s.markets[symbol]; !ok {
		return nil, fmt.Errorf("market not found: %s", symbol)
	}
	
	// Verify user has sufficient balance
	user, ok := s.users[userID]
	if !ok {
		return nil, fmt.Errorf("user not found")
	}
	
	quoteCurrency := s.markets[symbol].QuoteCurrency
	wallet := user.Wallets[quoteCurrency]
	
	var required *big.Float
	if orderType == "LIMIT" && price != nil {
		required = new(big.Float).Mul(quantity, price)
	} else {
		currentPrice := s.markets[symbol].Price
		required = new(big.Float).Mul(quantity, currentPrice)
	}
	
	if new(big.Float).Add(wallet.Locked, required).Cmp(wallet.Balance) > 0 {
		return nil, fmt.Errorf("insufficient balance")
	}
	
	s.orderID++
	order := &Order{
		ID: fmt.Sprintf("ORD_%d", s.orderID),
		UserID: userID, Symbol: symbol, Side: side, Type: orderType,
		Quantity: quantity, Price: price, Filled: big.NewFloat(0),
		Status: "PENDING", CreatedAt: time.Now(),
	}
	
	s.orders[order.ID] = order
	return order, nil
}

// ExecuteOrder executes an order
func (s *CEXService) ExecuteOrder(orderID string) (*Trade, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	order, ok := s.orders[orderID]
	if !ok {
		return nil, fmt.Errorf("order not found")
	}
	
	if order.Status != "PENDING" {
		return nil, fmt.Errorf("order not pending")
	}
	
	// Get current price
	price := s.markets[order.Symbol].Price
	if order.Price != nil {
		price = order.Price
	}
	
	// Execute trade
	s.tradeID++
	trade := &Trade{
		ID: fmt.Sprintf("TRD_%d", s.tradeID),
		OrderID: orderID, Symbol: order.Symbol, Side: order.Side,
		Price: price, Quantity: order.Quantity,
		Fee: new(big.Float).Mul(order.Quantity, price),
		Timestamp: time.Now(),
	}
	
	s.trades[trade.ID] = trade
	order.Status = "FILLED"
	order.Filled = order.Quantity
	
	return trade, nil
}

// CreateFuturesPosition creates a futures position
func (s *CEXService) CreateFuturesPosition(userID, symbol, side string, quantity *big.Float, leverage int, entryPrice *big.Float) *Position {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	pos := &Position{
		ID: fmt.Sprintf("POS_%d", time.Now().UnixNano()),
		UserID: userID, Symbol: symbol, Side: side,
		Quantity: quantity, EntryPrice: entryPrice, Leverage: leverage,
		LiquidationPrice: calculateLiquidationPrice(entryPrice, leverage, side == "LONG"),
		Margin: new(big.Float).Quo(new(big.Float).Mul(quantity, entryPrice), big.NewFloat(float64(leverage))),
		UnrealizedPNL: big.NewFloat(0),
	}
	
	s.positions[pos.ID] = pos
	return pos
}

func calculateLiquidationPrice(entry *big.Float, leverage int, isLong bool) *big.Float {
	liqPercent := 1.0 / float64(leverage)
	if !isLong {
		liqPercent = -liqPercent
	}
	mult := big.NewFloat(1 + liqPercent)
	return new(big.Float).Mul(entry, mult)
}

// CreateP2PTrade creates a P2P trade
func (s *CEXService) CreateP2PTrade(advertiser, side, currency string, amount, price *big.Float, paymentMethod string) *P2PTrade {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	trade := &P2PTrade{
		ID: fmt.Sprintf("P2P_%d", time.Now().UnixNano()),
		Advertiser: advertiser, Side: side, Currency: currency,
		Amount: amount, Price: price, PaymentMethod: paymentMethod,
		Status: "OPEN",
	}
	
	s.p2pTrades[trade.ID] = trade
	return trade
}

// GetMarkets returns all markets
func (s *CEXService) GetMarkets() []*Market {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	result := make([]*Market, 0)
	for _, m := range s.markets {
		result = append(result, m)
	}
	return result
}

// GetUserOrders returns user orders
func (s *CEXService) GetUserOrders(userID string) []*Order {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	var result []*Order
	for _, o := range s.orders {
		if o.UserID == userID {
			result = append(result, o)
		}
	}
	return result
}

// =============================================================================
// MAIN
// =============================================================================

func main() {
	fmt.Println("TigerEx CEX Trading System")
	fmt.Println("=========================")
	
	cex := NewCEXService()
	
	// Create user
	user := cex.CreateUser("user@tigerex.com", "trader1")
	fmt.Printf("\nUser created: %s\n", user.Username)
	
	// Get markets
	markets := cex.GetMarkets()
	fmt.Printf("\nMarkets: %d\n", len(markets))
	for _, m := range markets[:5] {
		fmt.Printf("  %s: %.2f\n", m.Symbol, m.Price)
	}
	
	// Create spot order
	order, _ := cex.CreateOrder(user.ID, "BTC/USDT", "BUY", "LIMIT", big.NewFloat(0.1), big.NewFloat(50000))
	fmt.Printf("\nOrder created: %s\n", order.ID)
	
	// Execute order
	trade, _ := cex.ExecuteOrder(order.ID)
	fmt.Printf("Trade executed: %s\n", trade.ID)
	
	// Create futures position
	position := cex.CreateFuturesPosition(user.ID, "BTC-USDT-PERP", "LONG", big.NewFloat(1), 10, big.NewFloat(50000))
	fmt.Printf("\nPosition created: %s\n", position.ID)
	fmt.Printf("  Leverage: %dx\n", position.Leverage)
	fmt.Printf("  Liq Price: %.2f\n", position.LiquidationPrice)
	
	// Create P2P trade
	p2p := cex.CreateP2PTrade(user.ID, "SELL", "USDT", big.NewFloat(1000), big.NewFloat(1), "BANK_TRANSFER")
	fmt.Printf("\nP2P Trade: %s\n", p2p.ID)
}
