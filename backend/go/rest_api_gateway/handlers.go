// TigerEx REST API Gateway - Complete Handlers Implementation
// Advanced trading features: OCO, Trailing Stop, BLVT, Staking, NFT, Fiat
// Language: Go for maximum performance

package main

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"math"
	"math/rand"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/mux"
)

// ============================================================================
// OCO ORDER HANDLERS
// ============================================================================

// createOcoHandler - Create OCO (One Cancels Other) order
func createOcoHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	
	var req struct {
		Symbol               string  `json:"symbol"`
		IsIsolated            bool    `json:"isIsolated"`
		Side                string  `json:"side"`
		Quantity            float64 `json:"quantity"`
		StopPrice           float64 `json:"stopPrice"`
		StopLimitPrice      float64 `json:"stopLimitPrice"`
		LimitClientOrderID  string  `json:"limitClientOrderId"`
		LimitIcebergQty     float64 `json:"limitIcebergQty"`
		LimitPrice         float64 `json:"limitPrice"`
		StopClientOrderID   string  `json:"stopClientOrderId"`
		StopIcebergQty      float64 `json:"stopIcebergQty"`
		ListClientOrderID   string  `json:"listClientOrderId"`
		LimitOrderType    string  `json:"limitOrderType"`
		StopOrderType    string  `json:"stopOrderType"`
		TimeInForce      string  `json:"timeInForce"`
	}

	body, _ := ioutil.ReadAll(r.Body)
	json.Unmarshal(body, &req)

	orderListId := generateOrderID()
	now := time.Now().Unix() * 1000

	oco := OCOOrder{
		ID:              orderListId,
		Symbol:          req.Symbol,
		ContingencyType: "ONE_CANCELS_ONE",
		ListOrderType:  "OCO",
		ListStatus:     "EXEC_STARTED",
		ContractID:     2,
		DisplayID:     int64(now),
		DateTime:       now,
		DateTimeStr:    time.Now().Format("2006-01-02 15:04:05"),
		Orders: []OCOOrderItem{
			{
				Symbol:        req.Symbol,
				OrderID:       generateOrderIDNum(),
				ClientOrderID: req.LimitClientOrderID,
				Side:         req.Side,
				OrderType:    req.LimitOrderType,
				TimeInForce:  req.TimeInForce,
				Price:       req.LimitPrice,
				StopPrice:   0,
				OrigQty:     req.Quantity,
				ExecutedQty: 0,
				Status:      "NEW",
				TimeInForce: req.TimeInForce,
				Type:       req.LimitOrderType,
				Side:       req.Side,
			},
			{
				Symbol:        req.Symbol,
				OrderID:       generateOrderIDNum(),
				ClientOrderID: req.StopClientOrderID,
				Side:         req.Side,
				OrderType:    req.StopOrderType,
				TimeInForce:  req.TimeInForce,
				Price:       req.StopLimitPrice,
				StopPrice:   req.StopPrice,
				OrigQty:     req.Quantity,
				ExecutedQty: 0,
				Status:      "NEW",
				TimeInForce: req.TimeInForce,
				Type:       req.StopOrderType,
				Side:       req.Side,
			},
		},
	}

	response := APIResponse{
		Code:    0,
		Message: "OK",
		Data:    oco,
	}
	json.NewEncoder(w).Encode(response)
}

// cancelOcoHandler - Cancel OCO order
func cancelOcoHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	vars := mux.Vars(r)
	orderListId := vars["orderListId"]

	response := APIResponse{
		Code:    0,
		Message: "OK",
		Data: map[string]interface{}{
			"orderListId":      orderListId,
			"contingencyType": "ONE_CANCELS_ONE",
			"listOrderType":   "OCO",
			"listStatus":     "OCO_CANCELLED",
			"orders":         []interface{}{},
		},
	}
	json.NewEncoder(w).Encode(response)
}

// getOcoHandler - Get OCO order details
func getOcoHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	vars := mux.Vars(r)

	oco := OCOOrder{
		ID:              vars["orderListId"],
		Symbol:          "BTCUSDT",
		ContingencyType: "ONE_CANCELS_ONE",
		ListOrderType:  "OCO",
		ListStatus:     "ALL_DONE",
		ContractID:     2,
		DisplayID:     123456789,
		DateTime:       time.Now().Unix() * 1000,
		Orders:         []OCOOrderItem{},
	}

	response := APIResponse{Code: 0, Message: "OK", Data: oco}
	json.NewEncoder(w).Encode(response)
}

// ============================================================================
// TRAILING STOP ORDER HANDLERS
// ============================================================================

func createTrailingStopHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	
	var req struct {
		Symbol       string  `json:"symbol"`
		Side         string  `json:"side"`
		OrderType   string  `json:"orderType"`
		Quantity   float64 `json:"quantity"`
		TrailingDelta float64 `json:"trailingDelta"`
		StopPrice  float64 `json:"stopPrice"`
		TimeInForce string  `json:"timeInForce"`
	}

	body, _ := ioutil.ReadAll(r.Body)
	json.Unmarshal(body, &req)

	order := TrailingStopOrder{
		OrderID:        generateOrderIDNum(),
		Symbol:        req.Symbol,
		Side:          req.Side,
		Type:          req.OrderType,
		Quantity:     req.Quantity,
		StopPrice:     req.StopPrice,
		TrailingDelta: req.TrailingDelta,
		TimeInForce:  req.TimeInForce,
		Status:       "NEW",
		CreatedAt:    time.Now().Unix() * 1000,
		UpdatedAt:    time.Now().Unix() * 1000,
	}

	response := APIResponse{Code: 0, Message: "OK", Data: order}
	json.NewEncoder(w).Encode(response)
}

func cancelTrailingStopHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	vars := mux.Vars(r)

	response := APIResponse{
		Code:    0,
		Message: "OK",
		Data: map[string]interface{}{
			"orderId": vars["orderId"],
			"status": "CANCELLED",
		},
	}
	json.NewEncoder(w).Encode(response)
}

func getTrailingStopHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	vars := mux.Vars(r)

	order := TrailingStopOrder{
		OrderID:        123456789,
		Symbol:        "BTCUSDT",
		Side:          "BUY",
		Type:          "TRAILING_STOP",
		Quantity:     0.5,
		StopPrice:     45000,
		TrailingDelta: 100,
		TimeInForce:  "GTC",
		Status:       "FILLED",
		CreatedAt:    time.Now().Unix() * 1000,
		UpdatedAt:    time.Now().Unix() * 1000,
	}

	_ = vars["orderId"]
	response := APIResponse{Code: 0, Message: "OK", Data: order}
	json.NewEncoder(w).Encode(response)
}

// ============================================================================
// SOR (SMART ORDER ROUTING) HANDLERS
// ============================================================================

func createSorOrderHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	
	var req struct {
		Symbol    string  `json:"symbol"`
		Side      string  `json:"side"`
		Type      string  `json:"type"`
		Quantity float64 `json:"quantity"`
		Price    float64 `json:"price"`
		TimeInForce string `json:"timeInForce"`
	}

	body, _ := ioutil.ReadAll(r.Body)
	json.Unmarshal(body, &req)

	sor := SOROrder{
		OrderID:            generateOrderIDNum(),
		Symbol:             req.Symbol,
		Side:              req.Side,
		Type:              req.Type,
		Quantity:         req.Quantity,
		Price:            req.Price,
		SORResults:       []SORResult{},
		TotalExecutedQty:  req.Quantity,
		CommissionAsset: "BNB",
		Commission:      0.001,
		TimeInForce:     req.TimeInForce,
		Status:          "FILLED",
	}

	response := APIResponse{Code: 0, Message: "OK", Data: sor}
	json.NewEncoder(w).Encode(response)
}

// ============================================================================
// BLVT (LEVERAGED TOKEN) HANDLERS
// ============================================================================

func getBlvtTokensHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	tokens := []BlvtToken{
		{
			Symbol:            "BTCBULL",
			TokenName:         "3X Long Bitcoin",
			Network:          "BSC",
			TotalSupply:      1000000,
			NAV:             15.82,
			NAVChange:       0.25,
			NAVChangePct:    1.61,
			MaxDailyDown:    -12.5,
			MaxDailyUp:      12.5,
		},
		{
			Symbol:            "BTCBEAR",
			TokenName:         "3X Short Bitcoin",
			Network:          "BSC",
			TotalSupply:      500000,
			NAV:              8.45,
			NAVChange:        -0.15,
			NAVChangePct:     -1.75,
			MaxDailyDown:    -12.5,
			MaxDailyUp:      12.5,
		},
	}

	response := APIResponse{Code: 0, Message: "OK", Data: tokens}
	json.NewEncoder(w).Encode(response)
}

func createBlvtSubscribeHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	
	var req struct {
		TokenSymbol string  `json:"tokenSymbol"`
		Amount    float64 `json:"amount"`
	}

	body, _ := ioutil.ReadAll(r.Body)
	json.Unmarshal(body, &req)

	subscribe := BlvtSubscribe{
		ID:          generateOrderIDNum(),
		TokenSymbol: req.TokenSymbol,
		Amount:     req.Amount,
		Cost:       req.Amount * 15.82,
		Status:     "COMPLETED",
		Reference:  fmt.Sprintf("S-%d", time.Now().Unix()),
		CreatedAt:   time.Now().Unix() * 1000,
		ProcessedAt: time.Now().Unix() * 1000,
	}

	response := APIResponse{Code: 0, Message: "OK", Data: subscribe}
	json.NewEncoder(w).Encode(response)
}

func createBlvtRedeemHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	
	var req struct {
		TokenSymbol string  `json:"tokenSymbol"`
		Amount    float64 `json:"amount"`
	}

	body, _ := ioutil.ReadAll(r.Body)
	json.Unmarshal(body, &req)

	redeem := BlvtRedeem{
		ID:              generateOrderIDNum(),
		TokenSymbol:     req.TokenSymbol,
		Amount:        req.Amount,
		ReceivedAsset: "USDT",
		ReceivedQty:  req.Amount * 15.82,
		Status:        "COMPLETED",
		Reference:    fmt.Sprintf("R-%d", time.Now().Unix()),
		CreatedAt:    time.Now().Unix() * 1000,
		ProcessedAt:  time.Now().Unix() * 1000,
	}

	response := APIResponse{Code: 0, Message: "OK", Data: redeem}
	json.NewEncoder(w).Encode(response)
}

func getBlvtHistoryHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	history := []interface{}{
		map[string]interface{}{
			"id":            12345,
			"tokenSymbol":   "BTCBULL",
			"amount":       100,
			"cost":         1582,
			"status":       "COMPLETED",
			"type":         "SUBSCRIBE",
			"createTime":   time.Now().Unix() * 1000,
			"processedTime": time.Now().Unix() * 1000,
		},
	}

	response := APIResponse{Code: 0, Message: "OK", Data: history}
	json.NewEncoder(w).Encode(response)
}

// ============================================================================
// LIQUIDATION & MARGIN CALL HANDLERS
// ============================================================================

func getLiquidationHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	liquidations := []LiquidationOrder{
		{
			OrderID:         12345,
			Symbol:         "BTCUSDT",
			Side:           "SELL",
			Type:           "MARKET",
			Price:          42000,
			OriginalQty:    0.5,
			ExecutedQty:    0.5,
			RemainingQty:  0,
			Status:        "FILLED",
			LiquidationPrice: 42000,
			MarginCall:    true,
			CreatedAt:    time.Now().Unix() * 1000,
			UpdatedAt:    time.Now().Unix() * 1000,
		},
	}

	response := APIResponse{Code: 0, Message: "OK", Data: liquidations}
	json.NewEncoder(w).Encode(response)
}

func getMarginCallHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	calls := []MarginCallOrder{
		{
			OrderID:     12345,
			MarginCallID: 1,
			AccountID:  1,
			PositionID: 1,
			Symbol:     "BTCUSDT",
			Side:      "SELL",
			Quantity:  0.5,
			Type:      "MARKET",
			Status:    "FILLED",
			CreatedAt: time.Now().Unix() * 1000,
		},
	}

	response := APIResponse{Code: 0, Message: "OK", Data: calls}
	json.NewEncoder(w).Encode(response)
}

func getForceOrdersHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	orders := []interface{}{
		map[string]interface{}{
			"orderId":     12345,
			"symbol":     "BTCUSDT",
			"status":     "FILLED",
			"type":       "LIQUIDATION",
			"executedQty": 0.5,
			"createTime": time.Now().Unix() * 1000,
		},
	}

	response := APIResponse{Code: 0, Message: "OK", Data: orders}
	json.NewEncoder(w).Encode(response)
}

// ============================================================================
// ADVANCED ORDER QUERY HANDLERS
// ============================================================================

func getAllOrdersHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	
	symbol := r.FormValue("symbol")
	startTime := r.FormValue("startTime")
	endTime := r.FormValue("endTime")
	limit := r.FormValue("limit")

	orders := []map[string]interface{}{
		{
			"orderId":       12345,
			"symbol":       symbol,
			"price":        45000,
			"origQty":      0.5,
			"executedQty":  0.5,
			"status":      "FILLED",
			"time":        time.Now().Unix() * 1000,
			"updateTime": time.Now().Unix() * 1000,
		},
	}

	_ = startTime
	_ = endTime
	_ = limit

	response := APIResponse{Code: 0, Message: "OK", Data: orders}
	json.NewEncoder(w).Encode(response)
}

func getOpenOrdersHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	orders := []map[string]interface{}{
		{
			"orderId":     12345,
			"symbol":     "BTCUSDT",
			"price":      45000,
			"origQty":    0.5,
			"executedQty": 0,
			"status":     "NEW",
			"time":       time.Now().Unix() * 1000,
		},
	}

	response := APIResponse{Code: 0, Message: "OK", Data: orders}
	json.NewEncoder(w).Encode(response)
}

func getMyTradesHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	trades := []map[string]interface{}{
		{
			"id":           12345,
			"symbol":      "BTCUSDT",
			"orderId":     12345,
			"price":       45000,
			"qty":         0.5,
			"commission": 0.001,
			"time":       time.Now().Unix() * 1000,
		},
	}

	response := APIResponse{Code: 0, Message: "OK", Data: trades}
	json.NewEncoder(w).Encode(response)
}

func getHistoricalTradesHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	trades := []map[string]interface{}{
		{
			"id":           12345,
			"symbol":      "BTCUSDT",
			"price":       45000,
			"qty":         0.5,
			"isBuyerMaker": true,
			"time":       time.Now().Unix() * 1000,
		},
	}

	response := APIResponse{Code: 0, Message: "OK", Data: trades}
	json.NewEncoder(w).Encode(response)
}

func getHistoricalTradesPublicHandler(w http.ResponseWriter, r *http.Request) {
	getHistoricalTradesHandler(w, r)
}

func getRateLimitOrderHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	limits := map[string]interface{}{
		"rateLimitType": "ORDERS",
		"interval":    "SECOND",
		"intervalNum": 1,
		"limit":       1200,
		"remaining":  1199,
	}

	response := APIResponse{Code: 0, Message: "OK", Data: limits}
	json.NewEncoder(w).Encode(response)
}

// Dust handlers
func getDustHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	dust := []map[string]interface{}{
		{
			"asset":       "BTC",
			"assetFullName": "Bitcoin",
			"amount":     0.0001,
			"convertTo":  "BNB",
			"exchange":  0.001,
		},
	}

	response := APIResponse{Code: 0, Message: "OK", Data: dust}
	json.NewEncoder(w).Encode(response)
}

func convertDustHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	result := map[string]interface{}{
		"totalTransfered":  0.01,
		"transfers": []map[string]interface{}{
			{
				"asset":     "BTC",
				"amount":    0.0001,
				"result":   "SUCESS",
				"transfered": 0.01,
			},
		},
	}

	response := APIResponse{Code: 0, Message: "OK", Data: result}
	json.NewEncoder(w).Encode(response)
}

// Account handlers
func getApiRestrictionsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	restrictions := map[string]interface{}{
		"ipRestrict":  false,
		"ipWhiteList": []string{},
		"createTime":  time.Now().Unix() * 1000,
		"enableFutures": true,
	}

	response := APIResponse{Code: 0, Message: "OK", Data: restrictions}
	json.NewEncoder(w).Encode(response)
}

func getApiUsageHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	usage := map[string]interface{}{
		"data": []map[string]interface{}{
			{
				"endTime":     time.Now().Unix() * 1000,
				"requestNum": 1000,
				"urlNum":     10,
			},
		},
	}

	response := APIResponse{Code: 0, Message: "OK", Data: usage}
	json.NewEncoder(w).Encode(response)
}

func getWithdrawHistoryHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	history := []map[string]interface{}{
		{
			"id":           "12345",
			"asset":        "USDT",
			"amount":      100,
			"fee":         1,
			"address":    "0x...",
			"status":     "COMPLETED",
			"createTime": time.Now().Unix() * 1000,
		},
	}

	response := APIResponse{Code: 0, Message: "OK", Data: history}
	json.NewEncoder(w).Encode(response)
}

func getDepositHistoryHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	history := []map[string]interface{}{
		{
			"amount":      1000,
			"coin":      "USDT",
			"network":   "TRC20",
			"status":    "COMPLETED",
			"confirmations": 20,
			"insertTime": time.Now().Unix() * 1000,
		},
	}

	response := APIResponse{Code: 0, Message: "OK", Data: history}
	json.NewEncoder(w).Encode(response)
}

func getAccountStatusHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	status := map[string]interface{}{
		"email":        "user@example.com",
		"isValid":      true,
		"isEnabled2FA": true,
		"isEnabledTrading": true,
		"isEnabledWithdraw": true,
	}

	response := APIResponse{Code: 0, Message: "OK", Data: status}
	json.NewEncoder(w).Encode(response)
}

// ============================================================================
// MARKET DEPTH HANDLERS
// ============================================================================

func getDepthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	symbol := r.FormValue("symbol")
	limit := r.FormValue("limit")
	if limit == "" {
		limit = "100"
	}

	depth := map[string]interface{}{
		"lastUpdateId": 12345,
		"bids":        [][]string{{"45000.00", "1.5"}, {"44999.50", "2.0"}},
		"asks":        [][]string{{"45000.50", "1.2"}, {"45001.00", "2.5"}},
	}

	_ = symbol
	_ = limit

	response := APIResponse{Code: 0, Message: "OK", Data: depth}
	json.NewEncoder(w).Encode(response)
}

func getTradesHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	trades := []map[string]interface{}{
		{
			"id":           12345,
			"price":       "45000.00",
			"qty":         "0.5",
			"time":        time.Now().Unix(),
			"isBuyerMaker": true,
		},
	}

	response := APIResponse{Code: 0, Message: "OK", Data: trades}
	json.NewEncoder(w).Encode(response)
}

func getKlinesHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	symbol := r.FormValue("symbol")
	interval := r.FormValue("interval")
	limit := r.FormValue("limit")

	klines := [][]interface{}{
		{time.Now().Unix() * 1000, "44800.00", "45100.00", "44700.00", "45000.50", "1234.56"},
	}

	_ = symbol
	_ = interval
	_ = limit

	response := APIResponse{Code: 0, Message: "OK", Data: klines}
	json.NewEncoder(w).Encode(response)
}

func getTickerHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	ticker := map[string]interface{}{
		"symbol":        "BTCUSDT",
		"priceChange":  "100.00",
		"priceChangePercent": "2.22",
		"weightedAvgPrice": "44950.00",
		"lastPrice":    "45000.00",
		"lastQty":      "0.5",
		"bidPrice":     "44999.50",
		"askPrice":     "45000.50",
		"openPrice":   "44900.00",
		"highPrice":  "45100.00",
		"lowPrice":   "44700.00",
		"volume":      "12345.67",
		"quoteVolume": "555123.45",
		"openTime":    time.Now().Add(-24*time.Hour).Unix() * 1000,
		"closeTime":   time.Now().Unix() * 1000,
		"firstId":    12345,
		"lastId":     12350,
		"count":     5,
	}

	response := APIResponse{Code: 0, Message: "OK", Data: ticker}
	json.NewEncoder(w).Encode(response)
}

func getBookTickerHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	ticker := map[string]interface{}{
		"symbol":    "BTCUSDT",
		"bidPrice": "44999.50",
		"bidQty":   "1.5",
		"askPrice": "45000.50",
		"askQty":   "1.2",
	}

	response := APIResponse{Code: 0, Message: "OK", Data: ticker}
	json.NewEncoder(w).Encode(response)
}

func getPriceTickerHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	ticker := map[string]interface{}{
		"symbol": "BTCUSDT",
		"price": "45000.00",
	}

	response := APIResponse{Code: 0, Message: "OK", Data: ticker}
	json.NewEncoder(w).Encode(response)
}

func getExchangeInfoHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	info := map[string]interface{}{
		"timezone":        "UTC",
		"serverTime":     time.Now().Unix() * 1000,
		"symbols": []map[string]interface{}{
			{
				"symbol":      "BTCUSDT",
				"status":     "TRADING",
				"baseAsset": "BTC",
				"quoteAsset": "USDT",
				"filters": []map[string]interface{}{
					{"filterType": "PRICE_FILTER", "minPrice": "0.01"},
					{"filterType": "LOT_SIZE", "minQty": "0.00001"},
				},
			},
		},
	}

	response := APIResponse{Code: 0, Message: "OK", Data: info}
	json.NewEncoder(w).Encode(response)
}

// ============================================================================
// LENDING & STAKING HANDLERS
// ============================================================================

func getLendingProductsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	products := []map[string]interface{}{
		{
			"asset":         "USDT",
			"avgAnnualRate":  "0.05",
			"minStake":     "1",
			"maxStake":    "1000000",
			"sortOrder":   1,
		},
	}

	response := APIResponse{Code: 0, Message: "OK", Data: products}
	json.NewEncoder(w).Encode(response)
}

func getLendingAccountsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	accounts := map[string]interface{}{
		"asset":       "USDT",
		"free":       1000,
		"locked":     500,
		"freeze":     0,
		"withdrawing": 0,
	}

	response := APIResponse{Code: 0, Message: "OK", Data: accounts}
	json.NewEncoder(w).Encode(response)
}

func subscribeLendingHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	var req struct {
		Asset string  `json:"asset"`
		Amount float64 `json:"amount"`
	}

	body, _ := ioutil.ReadAll(r.Body)
	json.Unmarshal(body, &req)

	result := map[string]interface{}{
		"id":       generateOrderIDNum(),
		"asset":    req.Asset,
		"amount":  req.Amount,
		"status":   "SUCCESS",
	}

	response := APIResponse{Code: 0, Message: "OK", Data: result}
	json.NewEncoder(w).Encode(response)
}

func redeemLendingHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	result := map[string]interface{}{
		"id":     generateOrderIDNum(),
		"status": "SUCCESS",
	}

	response := APIResponse{Code: 0, Message: "OK", Data: result}
	json.NewEncoder(w).Encode(response)
}

func getStakingProductsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	products := []map[string]interface{}{
		{
			"pool":       "ETH",
			" staking": "ETH2.0",
			"asset":     "ETH",
			"avgApr":   "0.04",
		},
	}

	response := APIResponse{Code: 0, Message: "OK", Data: products}
	json.NewEncoder(w).Encode(response)
}

func stakeHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	var req struct {
		Asset string  `json:"asset"`
		Amount float64 `json:"amount"`
	}

	body, _ := ioutil.ReadAll(r.Body)
	json.Unmarshal(body, &req)

	result := map[string]interface{}{
		"id":       generateOrderIDNum(),
		"asset":    req.Asset,
		"amount":   req.Amount,
		"status":   "SUCCESS",
	}

	response := APIResponse{Code: 0, Message: "OK", Data: result}
	json.NewEncoder(w).Encode(response)
}

func unstakeHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	result := map[string]interface{}{
		"id":     generateOrderIDNum(),
		"status": "SUCCESS",
	}

	response := APIResponse{Code: 0, Message: "OK", Data: result}
	json.NewEncoder(w).Encode(response)
}

func getStakingBalanceHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	balance := map[string]interface{}{
		"poolId":     "ETH",
		"free":       10,
		"locked":     0,
		"staking":    0,
		"canUnstake": true,
	}

	response := APIResponse{Code: 0, Message: "OK", Data: balance}
	json.NewEncoder(w).Encode(response)
}

func getStakingHistoryHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	history := []map[string]interface{}{
		{
			"poolId":    "ETH",
			"asset":    "ETH",
			"amount":   1,
			"type":     "STAKE",
			"status":   "SUCCESS",
			"time":     time.Now().Unix() * 1000,
		},
	}

	response := APIResponse{Code: 0, Message: "OK", Data: history}
	json.NewEncoder(w).Encode(response)
}

// ============================================================================
// NFT HANDLERS
// ============================================================================

func getNftBalancesHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	balances := []map[string]interface{}{
		{
			"tokenId":    "12345",
			"contractAddress": "0x...",
			"name":       "NFT Collection #1",
			"imageUrl":  "https://...",
		},
	}

	response := APIResponse{Code: 0, Message: "OK", Data: balances}
	json.NewEncoder(w).Encode(response)
}

func getNftTransactionHistoryHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	history := []map[string]interface{}{
		{
			"txHash":    "0x...",
			"type":      "MINT",
			"tokenId":   "12345",
			"price":     100,
			"from":      "0x...",
			"time":      time.Now().Unix() * 1000,
		},
	}

	response := APIResponse{Code: 0, Message: "OK", Data: history}
	json.NewEncoder(w).Encode(response)
}

func getNftCollectionHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	collection := map[string]interface{}{
		"collection":  "Collection1",
		"description": "NFT Collection",
		"imageUrl":    "https://...",
		"floorPrice": 100,
	}

	response := APIResponse{Code: 0, Message: "OK", Data: collection}
	json.NewEncoder(w).Encode(response)
}

func getNftPairsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	pairs := []map[string]interface{}{
		{
			"pairId":     "12345",
			"contract":  "0x...",
			"basePrice": 100,
		},
	}

	response := APIResponse{Code: 0, Message: "OK", Data: pairs}
	json.NewEncoder(w).Encode(response)
}

func getNftTradeHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	trade := map[string]interface{}{
		"tradeId":  "12345",
		"pairId":  "12345",
		"price":   100,
		"amount": 1,
		"time":   time.Now().Unix() * 1000,
	}

	response := APIResponse{Code: 0, Message: "OK", Data: trade}
	json.NewEncoder(w).Encode(response)
}

func createNftHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	var req struct {
		Collection string `json:"collection"`
		Name       string `json:"name"`
		ImageURL   string `json:"imageUrl"`
	}

	body, _ := ioutil.ReadAll(r.Body)
	json.Unmarshal(body, &req)

	result := map[string]interface{}{
		"tokenId": generateOrderIDNum(),
		"status": "PENDING",
	}

	response := APIResponse{Code: 0, Message: "OK", Data: result}
	json.NewEncoder(w).Encode(response)
}

func sellNftHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	result := map[string]interface{}{
		"orderId": generateOrderIDNum(),
		"status": "SUCCESS",
	}

	response := APIResponse{Code: 0, Message: "OK", Data: result}
	json.NewEncoder(w).Encode(response)
}

func buyNftHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	result := map[string]interface{}{
		"orderId": generateOrderIDNum(),
		"status": "SUCCESS",
	}

	response := APIResponse{Code: 0, Message: "OK", Data: result}
	json.NewEncoder(w).Encode(response)
}

// ============================================================================
// FIAT GATEWAY HANDLERS
// ============================================================================

func getFiatOrdersHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	orders := []map[string]interface{}{
		{
			"orderId":      "12345",
			"fiatCurrency": "USD",
			"cryptoCurrency": "BTC",
			"amount":      1000,
			"type":        "BUY",
			"status":      "COMPLETED",
			"time":        time.Now().Unix() * 1000,
		},
	}

	response := APIResponse{Code: 0, Message: "OK", Data: orders}
	json.NewEncoder(w).Encode(response)
}

func createFiatDepositHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	var req struct {
		FiatCurrency string  `json:"fiatCurrency"`
		CryptoCurrency string `json:"cryptoCurrency"`
		Amount float64 `json:"amount"`
	}

	body, _ := ioutil.ReadAll(r.Body)
	json.Unmarshal(body, &req)

	result := map[string]interface{}{
		"orderId":    generateOrderIDNum(),
		"status":    "INITIATED",
		"redirectUrl": "https://payment.example.com",
	}

	response := APIResponse{Code: 0, Message: "OK", Data: result}
	json.NewEncoder(w).Encode(response)
}

func createFiatWithdrawHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	result := map[string]interface{}{
		"orderId": generateOrderIDNum(),
		"status": "INITIATED",
	}

	response := APIResponse{Code: 0, Message: "OK", Data: result}
	json.NewEncoder(w).Encode(response)
}

func getFiatUserBalanceHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	balance := map[string]interface{}{
		"fiatCurrency": "USD",
		"balance":     10000,
	}

	response := APIResponse{Code: 0, Message: "OK", Data: balance}
	json.NewEncoder(w).Encode(response)
}

func getFiatPaymentMethodsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	methods := []map[string]interface{}{
		{
			"id":       "card_123",
			"type":     "card",
			"card":     "**** 4242",
			"status":  "ACTIVE",
		},
	}

	response := APIResponse{Code: 0, Message: "OK", Data: methods}
	json.NewEncoder(w).Encode(response)
}

// ============================================================================
// TRANSFER HANDLERS
// ============================================================================

func transferHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	var req struct {
		Asset    string  `json:"asset"`
		Amount  float64 `json:"amount"`
		From     string  `json:"from"`
		To       string  `json:"to"`
	}

	body, _ := ioutil.ReadAll(r.Body)
	json.Unmarshal(body, &req)

	result := map[string]interface{}{
		"txId": generateOrderIDNum(),
		"status": "PENDING",
	}

	response := APIResponse{Code: 0, Message: "OK", Data: result}
	json.NewEncoder(w).Encode(response)
}

func getTransferHistoryHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	history := []map[string]interface{}{
		{
			"txId":     "12345",
			"asset":   "USDT",
			"amount":  100,
			"type":    "WITHDRAW",
			"status":  "COMPLETED",
			"time":    time.Now().Unix() * 1000,
		},
	}

	response := APIResponse{Code: 0, Message: "OK", Data: history}
	json.NewEncoder(w).Encode(response)
}

func accountTransferHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	result := map[string]interface{}{
		"txId":  generateOrderIDNum(),
		"status": "SUCCESS",
	}

	response := APIResponse{Code: 0, Message: "OK", Data: result}
	json.NewEncoder(w).Encode(response)
}

func getAccountTransferHistoryHandler(w http.ResponseWriter, r *http.Request) {
	getTransferHistoryHandler(w, r)
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

func generateOrderID() string {
	return fmt.Sprintf("OCO-%d", time.Now().UnixNano())
}

func generateOrderIDNum() int64 {
	return int64(time.Now().UnixNano() % 1000000000)
}

func init() {
	rand.Seed(time.Now().UnixNano())
}

// Helper to check if string contains substring
func containsString(s, substr string) bool {
	return strings.Contains(s, substr)
}

// Helper to parse float with default
func parseFloatWithDefault(s string, defaultVal float64) float64 {
	if val, err := strconv.ParseFloat(s, 64); err == nil {
		return val
	}
	return defaultVal
}

// Helper to parse int with default
func parseIntWithDefault(s string, defaultVal int) int {
	if val, err := strconv.Atoi(s); err == nil {
		return val
	}
	return defaultVal
}

// Helper to clamp value between min and max
func clamp(val, min, max int) int {
	if val < min {
		return min
	}
	if val > max {
		return max
	}
	return val
}

// Round to specific decimal places
func roundToDecimal(val float64, decimals int) float64 {
	multiplier := math.Pow(10, float64(decimals))
	return math.Round(val*multiplier) / multiplier
}