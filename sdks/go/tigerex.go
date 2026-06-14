package tigerex

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

// ============================================================================
// CLIENT
// ============================================================================

// Client represents TigerEx API client
type Client struct {
	BaseURL    string
	APIKey    string
	APISecret string
	HTTPClient *http.Client
}

// NewClient creates new TigerEx client
func NewClient(apiKey, apiSecret string, testnet bool) *Client {
	baseURL := "https://api-test.tigerex.com"
	if !testnet {
		baseURL = "https://api.tigerex.com"
	}

	return &Client{
		BaseURL:    baseURL,
		APIKey:    apiKey,
		APISecret: apiSecret,
		HTTPClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// ============================================================================
// REQUEST HELPERS
// ============================================================================

func (c *Client) sign(params map[string]string) string {
	var keys []string
	for k := range params {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var query string
	for i, k := range keys {
		if i > 0 {
			query += "&"
		}
		query += fmt.Sprintf("%s=%s", k, params[k])
	}

	mac := hmac.New(sha256.New, []byte(c.APISecret))
	mac.Write([]byte(query))
	return fmt.Sprintf("%x", mac.Bytes())
}

func (c *Client) request(method, endpoint string, params map[string]string, signed bool) ([]byte, error) {
	baseURL := c.BaseURL + endpoint

	reqParams := url.Values{}
	for k, v := range params {
		reqParams.Add(k, v)
	}

	if signed && c.APIKey != "" {
		reqParams.Add("timestamp", strconv.FormatInt(time.Now().UnixMilli(), 10))
		reqParams.Add("signature", c.sign(reqParams))
	}

	var reqURL string
	if method == "GET" && len(reqParams) > 0 {
		reqURL = baseURL + "?" + reqParams.Encode()
	} else {
		reqURL = baseURL
	}

	req, err := http.NewRequest(method, reqURL, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "TigerEx-Go-SDK/1.0.0")

	if c.APIKey != "" {
		req.Header.Set("X-MEX-APIKEY", c.APIKey)
	}

	if method == "POST" || method == "PUT" {
		req.Body = io.NopCloser(bytes.NewBufferString(reqParams.Encode()))
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("API error: %s", string(body))
	}

	return body, nil
}

// ============================================================================
// MARKET DATA
// ============================================================================

// Ping tests connectivity
func (c *Client) Ping() (map[string]interface{}, error) {
	data, err := c.request("GET", "/api/v3/ping", nil, false)
	if err != nil {
		return nil, err
	}

	var result map[string]interface{}
	json.Unmarshal(data, &result)
	return result, nil
}

// Time gets server time
func (c *Client) Time() (map[string]interface{}, error) {
	data, err := c.request("GET", "/api/v3/time", nil, false)
	if err != nil {
		return nil, err
	}

	var result map[string]interface{}
	json.Unmarshal(data, &result)
	return result, nil
}

// ExchangeInfo gets exchange info
func (c *Client) ExchangeInfo(symbol string) (map[string]interface{}, error) {
	params := map[string]string{}
	if symbol != "" {
		params["symbol"] = symbol
	}

	data, err := c.request("GET", "/api/v3/exchangeInfo", params, false)
	if err != nil {
		return nil, err
	}

	var result map[string]interface{}
	json.Unmarshal(data, &result)
	return result, nil
}

// TickerPrice gets price for symbol
func (c *Client) TickerPrice(symbol string) (map[string]interface{}, error) {
	data, err := c.request("GET", "/api/v3/ticker/price", map[string]string{"symbol": symbol}, false)
	if err != nil {
		return nil, err
	}

	var result map[string]interface{}
	json.Unmarshal(data, &result)
	return result, nil
}

// Ticker24h gets 24h ticker
func (c *Client) Ticker24h(symbol string) (map[string]interface{}, error) {
	params := map[string]string{}
	if symbol != "" {
		params["symbol"] = symbol
	}

	data, err := c.request("GET", "/api/v3/ticker/24hr", params, false)
	if err != nil {
		return nil, err
	}

	var result map[string]interface{}
	json.Unmarshal(data, &result)
	return result, nil
}

// Depth gets order book depth
func (c *Client) Depth(symbol string, limit int) (map[string]interface{}, error) {
	data, err := c.request("GET", "/api/v3/depth", map[string]string{
		"symbol": symbol,
		"limit":  strconv.Itoa(limit),
	}, false)
	if err != nil {
		return nil, err
	}

	var result map[string]interface{}
	json.Unmarshal(data, &result)
	return result, nil
}

// Trades gets recent trades
func (c *Client) Trades(symbol string, limit int) ([]map[string]interface{}, error) {
	data, err := c.request("GET", "/api/v3/trades", map[string]string{
		"symbol": symbol,
		"limit":  strconv.Itoa(limit),
	}, false)
	if err != nil {
		return nil, err
	}

	var result []map[string]interface{}
	json.Unmarshal(data, &result)
	return result, nil
}

// Klines gets klines
func (c *Client) Klines(symbol, interval string, limit int) ([][]interface{}, error) {
	data, err := c.request("GET", "/api/v3/klines", map[string]string{
		"symbol":   symbol,
		"interval": interval,
		"limit":    strconv.Itoa(limit),
	}, false)
	if err != nil {
		return nil, err
	}

	var result [][]interface{}
	json.Unmarshal(data, &result)
	return result, nil
}

// ============================================================================
// ACCOUNT
// ============================================================================

// Account gets account info
func (c *Client) Account() (map[string]interface{}, error) {
	data, err := c.request("GET", "/api/v3/account", nil, true)
	if err != nil {
		return nil, err
	}

	var result map[string]interface{}
	json.Unmarshal(data, &result)
	return result, nil
}

// ============================================================================
// ORDERS
// ============================================================================

// CreateOrder creates new order
func (c *Client) CreateOrder(params map[string]interface{}) (map[string]interface{}, error) {
	stringParams := make(map[string]string)
	for k, v := range params {
		stringParams[k] = fmt.Sprintf("%v", v)
	}

	data, err := c.request("POST", "/api/v3/order", stringParams, true)
	if err != nil {
		return nil, err
	}

	var result map[string]interface{}
	json.Unmarshal(data, &result)
	return result, nil
}

// GetOrder gets order by ID
func (c *Client) GetOrder(symbol string, orderID int64) (map[string]interface{}, error) {
	data, err := c.request("GET", "/api/v3/order", map[string]string{
		"symbol":  symbol,
		"orderId": strconv.FormatInt(orderID, 10),
	}, true)
	if err != nil {
		return nil, err
	}

	var result map[string]interface{}
	json.Unmarshal(data, &result)
	return result, nil
}

// GetOpenOrders gets open orders
func (c *Client) GetOpenOrders(symbol string) ([]map[string]interface{}, error) {
	params := map[string]string{}
	if symbol != "" {
		params["symbol"] = symbol
	}

	data, err := c.request("GET", "/api/v3/openOrders", params, true)
	if err != nil {
		return nil, err
	}

	var result []map[string]interface{}
	json.Unmarshal(data, &result)
	return result, nil
}

// CancelOrder cancels order
func (c *Client) CancelOrder(symbol string, orderID int64) (map[string]interface{}, error) {
	data, err := c.request("DELETE", "/api/v3/order", map[string]string{
		"symbol":  symbol,
		"orderId": strconv.FormatInt(orderID, 10),
	}, true)
	if err != nil {
		return nil, err
	}

	var result map[string]interface{}
	json.Unmarshal(data, &result)
	return result, nil
}

// ============================================================================
// WALLET
// ============================================================================

// DepositAddress gets deposit address
func (c *Client) DepositAddress(coin, network string) (map[string]interface{}, error) {
	params := map[string]string{"coin": coin}
	if network != "" {
		params["network"] = network
	}

	data, err := c.request("GET", "/api/v3/deposit/address", params, true)
	if err != nil {
		return nil, err
	}

	var result map[string]interface{}
	json.Unmarshal(data, &result)
	return result, nil
}

// Withdraw withdraws funds
func (c *Client) Withdraw(coin, address string, amount float64, network string) (map[string]interface{}, error) {
	params := map[string]string{
		"coin":    coin,
		"address": address,
		"amount":  strconv.FormatFloat(amount, 'f', -1, 64),
	}
	if network != "" {
		params["network"] = network
	}

	data, err := c.request("POST", "/api/v3/withdraw/apply", params, true)
	if err != nil {
		return nil, err
	}

	var result map[string]interface{}
	json.Unmarshal(data, &result)
	return result, nil
}

// ============================================================================
// CONVENIENCE METHODS
// ============================================================================

// BuyLimit places limit buy order
func (c *Client) BuyLimit(symbol string, quantity, price float64) (map[string]interface{}, error) {
	return c.CreateOrder(map[string]interface{}{
		"symbol":   symbol,
		"side":    "BUY",
		"type":    "LIMIT",
		"quantity": quantity,
		"price":   price,
	})
}

// SellLimit places limit sell order
func (c *Client) SellLimit(symbol string, quantity, price float64) (map[string]interface{}, error) {
	return c.CreateOrder(map[string]interface{}{
		"symbol":   symbol,
		"side":    "SELL",
		"type":    "LIMIT",
		"quantity": quantity,
		"price":   price,
	})
}

// BuyMarket places market buy order
func (c *Client) BuyMarket(symbol string, quantity float64) (map[string]interface{}, error) {
	return c.CreateOrder(map[string]interface{}{
		"symbol":   symbol,
		"side":    "BUY",
		"type":    "MARKET",
		"quantity": quantity,
	})
}

// SellMarket places market sell order
func (c *Client) SellMarket(symbol string, quantity float64) (map[string]interface{}, error) {
	return c.CreateOrder(map[string]interface{}{
		"symbol":   symbol,
		"side":    "SELL",
		"type":    "MARKET",
		"quantity": quantity,
	})
}

// ============================================================================
// WEBSOCKET STREAM
// ============================================================================

// WebSocketStream represents WebSocket stream client
type WebSocketStream struct {
	URL          string
	Subscriptions []string
}

// NewWebSocketStream creates new WebSocket stream client
func NewWebSocketStream(testnet bool) *WebSocketStream {
	url := "wss://stream-test.tigerex.com/ws"
	if !testnet {
		url = "wss://stream.tigerex.com/ws"
	}

	return &WebSocketStream{
		URL:          url,
		Subscriptions: []string{},
	}
}

// Subscribe subscribes to streams
func (ws *WebSocketStream) Subscribe(streams []string) {
	ws.Subscriptions = append(ws.Subscriptions, streams...)
}

// Unsubscribe unsubscribes from streams
func (ws *WebSocketStream) Unsubscribe(streams []string) {
	var remaining []string
	for _, s := range ws.Subscriptions {
		found := false
		for _, f := range streams {
			if s == f {
				found = true
				break
			}
		}
		if !found {
			remaining = append(remaining, s)
		}
	}
	ws.Subscriptions = remaining
}

// ============================================================================
// VERSION
// ============================================================================

const (
	Version = "1.0.0"
)

// ============================================================================
// ERROR HANDLING
// ============================================================================

// Error represents API error
type Error struct {
	Code    int    `json:"code"`
	Message string `json:"msg"`
}

func (e *Error) Error() string {
	return fmt.Sprintf("[%d] %s", e.Code, e.Message)
}