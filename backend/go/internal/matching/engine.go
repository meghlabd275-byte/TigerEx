// Package matching is the Go client for the canonical Rust matching engine.
//
// The engine is the settlement authority for price-time priority: this package
// only drives it. The engine runs as a long-lived child process speaking one
// JSON request per line on stdin and one JSON response per line on stdout, so
// the gateway can embed it without a second network hop. A request and its
// response are serialised under a mutex, which also preserves arrival order.
//
// When the engine binary is not configured the client is nil and every caller
// fails closed rather than inventing a fill.
package matching

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
)

// ErrUnavailable is returned when the engine is not configured or has stopped.
var ErrUnavailable = errors.New("matching engine is not available")

// ErrRejected wraps a rejection reported by the engine (validation, duplicate
// order, insufficient liquidity). It is distinct from ErrUnavailable so a
// caller can tell "the engine said no" from "the engine is gone".
var ErrRejected = errors.New("matching engine rejected the request")

// MarketSpec is the engine's view of a tradable market.
type MarketSpec struct {
	ID                 string  `json:"id"`
	BaseAsset          string  `json:"base_asset"`
	QuoteAsset         string  `json:"quote_asset"`
	Status             string  `json:"status"`
	PricePrecision     uint32  `json:"price_precision"`
	QuantityPrecision  uint32  `json:"quantity_precision"`
	MinQuantity        float64 `json:"min_quantity"`
	MaxQuantity        float64 `json:"max_quantity"`
	MinPrice           float64 `json:"min_price"`
	MaxPrice           float64 `json:"max_price"`
	TickSize           float64 `json:"tick_size"`
	StepSize           float64 `json:"step_size"`
	MakerFee           float64 `json:"maker_fee"`
	TakerFee           float64 `json:"taker_fee"`
	MinNotional        float64 `json:"min_notional"`
	TradingEnabled     bool    `json:"trading_enabled"`
	AutoSettleInterval int64   `json:"auto_settle_interval"`
}

// OrderSpec is a placement request. Iceberg orders withhold part of the size
// from the book; a zero IcebergQuantity places a normal order.
type OrderSpec struct {
	ID              string
	UserID          string
	Market          string
	Side            string // "buy" | "sell"
	OrderType       string // "limit" | "market"
	Price           float64
	Quantity        float64
	IcebergQuantity float64
	DisplayQuantity float64
}

// Trade is one execution reported by the engine. BuyerUserID and SellerUserID
// identify the two sides; OrderID is the resting (maker) order that supplied
// the liquidity.
type Trade struct {
	ID           string  `json:"id"`
	OrderID      string  `json:"order_id"`
	Market       string  `json:"market"`
	Side         string  `json:"side"`
	Price        float64 `json:"price"`
	Quantity     float64 `json:"quantity"`
	Fee          float64 `json:"fee"`
	FeeCurrency  string  `json:"fee_currency"`
	Maker        bool    `json:"maker"`
	BuyerUserID  string  `json:"buyer_user_id"`
	SellerUserID string  `json:"seller_user_id"`
	CreatedAt    int64   `json:"created_at"`
}

// DepthLevel is one aggregated price level.
type DepthLevel struct {
	Price    float64 `json:"price"`
	Quantity float64 `json:"quantity"`
}

// DepthSnapshot is a bounded, visible-only view of a market's book.
type DepthSnapshot struct {
	Market string       `json:"market"`
	Bids   []DepthLevel `json:"bids"`
	Asks   []DepthLevel `json:"asks"`
}

// Client drives one engine child process.
type Client struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	reader *bufio.Reader
	mu     sync.Mutex
	closed bool
}

// Start launches the engine binary. A blank path fails closed with
// ErrUnavailable so a misconfigured deployment never trades against a phantom
// engine.
func Start(binPath string) (*Client, error) {
	if strings.TrimSpace(binPath) == "" {
		return nil, ErrUnavailable
	}
	cmd := exec.Command(binPath)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("engine stdin: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("engine stdout: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start matching engine: %w", err)
	}
	return &Client{cmd: cmd, stdin: stdin, reader: bufio.NewReaderSize(stdout, 1<<20)}, nil
}

// Close stops the engine process.
func (c *Client) Close() error {
	if c == nil {
		return nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return nil
	}
	c.closed = true
	_ = c.stdin.Close()
	if c.cmd != nil && c.cmd.Process != nil {
		_ = c.cmd.Process.Kill()
		_, _ = c.cmd.Process.Wait()
	}
	return nil
}

// addMarketRequest registers a market. The market object is nested under
// `market`.
type addMarketRequest struct {
	Op     string      `json:"op"`
	Market *MarketSpec `json:"market"`
}

// placeOrderRequest submits an order. The engine addresses the market by its id
// string, which is also named `market` on the wire; keeping it a separate struct
// from addMarketRequest avoids two fields claiming the same JSON key.
type placeOrderRequest struct {
	Op              string  `json:"op"`
	ID              string  `json:"id"`
	UserID          string  `json:"user_id"`
	Market          string  `json:"market"`
	Side            string  `json:"side"`
	OrderType       string  `json:"order_type"`
	Price           float64 `json:"price"`
	Quantity        float64 `json:"quantity"`
	IcebergQuantity float64 `json:"iceberg_quantity"`
	DisplayQuantity float64 `json:"display_quantity"`
}

type cancelOrderRequest struct {
	Op      string `json:"op"`
	OrderID string `json:"order_id"`
}

type depthRequest struct {
	Op     string `json:"op"`
	Market string `json:"market"`
	Limit  int    `json:"limit"`
}

type engineResponse struct {
	OK     bool           `json:"ok"`
	Trades []Trade        `json:"trades"`
	Depth  *DepthSnapshot `json:"depth"`
	Error  string         `json:"error"`
}

// call writes one request and reads exactly one response. The engine is
// single-threaded, so calls are serialised.
func (c *Client) call(ctx context.Context, req interface{}) (*engineResponse, error) {
	if c == nil {
		return nil, ErrUnavailable
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return nil, ErrUnavailable
	}
	payload, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("encode engine request: %w", err)
	}
	if _, err := c.stdin.Write(append(payload, '\n')); err != nil {
		c.closed = true
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	line, err := c.reader.ReadBytes('\n')
	if err != nil {
		c.closed = true
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	var resp engineResponse
	if err := json.Unmarshal(line, &resp); err != nil {
		return nil, fmt.Errorf("decode engine response: %w", err)
	}
	if !resp.OK {
		return &resp, fmt.Errorf("%w: %s", ErrRejected, resp.Error)
	}
	return &resp, nil
}

// AddMarket registers a market with the engine. It is idempotent on the engine
// side (a re-added market replaces the prior definition).
func (c *Client) AddMarket(ctx context.Context, m MarketSpec) error {
	if c == nil {
		return ErrUnavailable
	}
	_, err := c.call(ctx, addMarketRequest{Op: "add_market", Market: &m})
	return err
}

// PlaceOrder submits an order and returns the executions it produced. An empty
// slice means the order rested on the book unfilled.
func (c *Client) PlaceOrder(ctx context.Context, o OrderSpec) ([]Trade, error) {
	if c == nil {
		return nil, ErrUnavailable
	}
	resp, err := c.call(ctx, placeOrderRequest{
		Op:              "place_order",
		ID:              o.ID,
		UserID:          o.UserID,
		Market:          o.Market,
		Side:            o.Side,
		OrderType:       o.OrderType,
		Price:           o.Price,
		Quantity:        o.Quantity,
		IcebergQuantity: o.IcebergQuantity,
		DisplayQuantity: o.DisplayQuantity,
	})
	if err != nil {
		return nil, err
	}
	return resp.Trades, nil
}

// CancelOrder removes a resting order from the book.
func (c *Client) CancelOrder(ctx context.Context, orderID string) error {
	if c == nil {
		return ErrUnavailable
	}
	_, err := c.call(ctx, cancelOrderRequest{Op: "cancel_order", OrderID: orderID})
	return err
}

// Depth returns the aggregated visible book for a market.
func (c *Client) Depth(ctx context.Context, market string, limit int) (*DepthSnapshot, error) {
	if c == nil {
		return nil, ErrUnavailable
	}
	resp, err := c.call(ctx, depthRequest{Op: "depth", Market: market, Limit: limit})
	if err != nil {
		return nil, err
	}
	return resp.Depth, nil
}
