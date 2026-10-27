package pricefeed

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// HTTPSource reads market data from the TigerEx market data service over HTTP.
// That service is the authoritative source; it is fed by the exchange's own
// matching engine and trade stream, not by any third-party exchange.
type HTTPSource struct {
	baseURL string
	client  *http.Client
}

// NewHTTPSource creates a source pointed at baseURL, e.g.
// "http://127.0.0.1:8081".
func NewHTTPSource(baseURL string) *HTTPSource {
	return &HTTPSource{
		baseURL: strings.TrimRight(baseURL, "/"),
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// envelope is the {"success":bool,"data":...} wrapper the service returns.
type envelope struct {
	Success bool            `json:"success"`
	Data    json.RawMessage `json:"data"`
	Error   string          `json:"error,omitempty"`
}

// tickerDTO mirrors the market data service's Ticker.
type tickerDTO struct {
	Symbol         string    `json:"symbol"`
	LastPrice      float64   `json:"last_price"`
	PriceChange    float64   `json:"price_change"`
	PriceChangePct float64   `json:"price_change_percent"`
	High24h        float64   `json:"high_24h"`
	Low24h         float64   `json:"low_24h"`
	Volume24h      float64   `json:"volume_24h"`
	QuoteVolume24h float64   `json:"quote_volume_24h"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type orderBookEntryDTO struct {
	Price    float64 `json:"price"`
	Quantity float64 `json:"quantity"`
}

type orderBookDTO struct {
	Symbol       string              `json:"symbol"`
	Bids         []orderBookEntryDTO `json:"bids"`
	Asks         []orderBookEntryDTO `json:"asks"`
	LastUpdateID uint64              `json:"last_update_id"`
	Timestamp    time.Time           `json:"timestamp"`
}

type tradeDTO struct {
	ID           string    `json:"id"`
	Price        float64   `json:"price"`
	Quantity     float64   `json:"quantity"`
	IsBuyerMaker bool      `json:"is_buyer_maker"`
	Timestamp    time.Time `json:"timestamp"`
}

type klineDTO struct {
	OpenTime time.Time `json:"open_time"`
	Open     float64   `json:"open"`
	High     float64   `json:"high"`
	Low      float64   `json:"low"`
	Close    float64   `json:"close"`
	Volume   float64   `json:"volume"`
	IsClosed bool      `json:"is_closed"`
}

type symbolInfoDTO struct {
	Symbol      string  `json:"symbol"`
	BaseAsset   string  `json:"base_asset"`
	QuoteAsset  string  `json:"quote_asset"`
	Status      string  `json:"status"`
	MinPrice    float64 `json:"min_price"`
	MaxPrice    float64 `json:"max_price"`
	TickSize    float64 `json:"tick_size"`
	MinQuantity float64 `json:"min_quantity"`
	MaxQuantity float64 `json:"max_quantity"`
	StepSize    float64 `json:"step_size"`
}

// get performs a GET and decodes the envelope's data into out.
func (s *HTTPSource) get(ctx context.Context, path string, query url.Values, out interface{}) error {
	endpoint := s.baseURL + path
	if len(query) > 0 {
		endpoint += "?" + query.Encode()
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrSourceUnavailable, err)
	}

	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrSourceUnavailable, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return fmt.Errorf("%w: reading response: %v", ErrSourceUnavailable, err)
	}

	if resp.StatusCode == http.StatusNotFound {
		return ErrSymbolNotFound
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("%w: upstream status %d: %s", ErrSourceUnavailable, resp.StatusCode, truncate(body, 200))
	}

	var env envelope
	if err := json.Unmarshal(body, &env); err != nil {
		return fmt.Errorf("%w: decoding response: %v", ErrSourceUnavailable, err)
	}
	if !env.Success {
		if env.Error != "" {
			return fmt.Errorf("%w: %s", ErrSourceUnavailable, env.Error)
		}
		return ErrSourceUnavailable
	}

	if out == nil {
		return nil
	}
	if err := json.Unmarshal(env.Data, out); err != nil {
		return fmt.Errorf("%w: decoding data: %v", ErrSourceUnavailable, err)
	}
	return nil
}

func truncate(b []byte, n int) string {
	if len(b) <= n {
		return string(b)
	}
	return string(b[:n]) + "..."
}

// Tickers returns every listed market's ticker.
func (s *HTTPSource) Tickers(ctx context.Context) ([]*PriceTick, error) {
	var dtos []tickerDTO
	if err := s.get(ctx, "/api/v1/tickers", nil, &dtos); err != nil {
		return nil, err
	}

	out := make([]*PriceTick, 0, len(dtos))
	for _, d := range dtos {
		out = append(out, &PriceTick{
			Symbol:       d.Symbol,
			Price:        d.LastPrice,
			Change24h:    d.PriceChange,
			ChangePct24h: d.PriceChangePct,
			High24h:      d.High24h,
			Low24h:       d.Low24h,
			Volume24h:    d.Volume24h,
			QuoteVolume:  d.QuoteVolume24h,
			Timestamp:    d.UpdatedAt,
		})
	}
	return out, nil
}

// Ticker returns one market's ticker.
func (s *HTTPSource) Ticker(ctx context.Context, symbol string) (*PriceTick, error) {
	var d tickerDTO
	if err := s.get(ctx, "/api/v1/ticker/"+url.PathEscape(symbol), nil, &d); err != nil {
		return nil, err
	}
	// Guard against an upstream that answers for a different market than the one
	// requested; serving another symbol's price would be worse than an error.
	if d.Symbol == "" || d.Symbol != symbol {
		return nil, fmt.Errorf("%w: %s", ErrSymbolNotFound, symbol)
	}
	return &PriceTick{
		Symbol:       d.Symbol,
		Price:        d.LastPrice,
		Change24h:    d.PriceChange,
		ChangePct24h: d.PriceChangePct,
		High24h:      d.High24h,
		Low24h:       d.Low24h,
		Volume24h:    d.Volume24h,
		QuoteVolume:  d.QuoteVolume24h,
		Timestamp:    d.UpdatedAt,
	}, nil
}

// OrderBook returns one market's book.
func (s *HTTPSource) OrderBook(ctx context.Context, symbol string, limit int) (*OrderBook, error) {
	var d orderBookDTO
	query := url.Values{"limit": []string{strconv.Itoa(limit)}}
	if err := s.get(ctx, "/api/v1/orderbook/"+url.PathEscape(symbol), query, &d); err != nil {
		return nil, err
	}

	book := &OrderBook{
		Symbol:       d.Symbol,
		Bids:         make([]OrderBookLevel, 0, len(d.Bids)),
		Asks:         make([]OrderBookLevel, 0, len(d.Asks)),
		LastUpdateID: int64(d.LastUpdateID),
		Timestamp:    d.Timestamp,
	}
	for _, b := range d.Bids {
		book.Bids = append(book.Bids, OrderBookLevel{Price: b.Price, Amount: b.Quantity})
	}
	for _, a := range d.Asks {
		book.Asks = append(book.Asks, OrderBookLevel{Price: a.Price, Amount: a.Quantity})
	}
	return book, nil
}

// Trades returns recent public trades.
func (s *HTTPSource) Trades(ctx context.Context, symbol string, limit int) ([]Trade, error) {
	var dtos []tradeDTO
	query := url.Values{"limit": []string{strconv.Itoa(limit)}}
	if err := s.get(ctx, "/api/v1/trades/"+url.PathEscape(symbol), query, &dtos); err != nil {
		return nil, err
	}

	out := make([]Trade, 0, len(dtos))
	for _, d := range dtos {
		out = append(out, Trade{
			ID:           hashID(d.ID),
			Price:        d.Price,
			Qty:          d.Quantity,
			Time:         d.Timestamp,
			IsBuyerMaker: d.IsBuyerMaker,
		})
	}
	return out, nil
}

// hashID converts the service's string trade id into the numeric id the API
// exposes. Non-numeric ids map to zero rather than a fabricated value.
func hashID(id string) int64 {
	n, err := strconv.ParseInt(id, 10, 64)
	if err != nil {
		return 0
	}
	return n
}

// Klines returns candlesticks.
func (s *HTTPSource) Klines(ctx context.Context, symbol, interval string, limit int) ([]Kline, error) {
	var dtos []klineDTO
	query := url.Values{"limit": []string{strconv.Itoa(limit)}}
	path := "/api/v1/klines/" + url.PathEscape(symbol) + "/" + url.PathEscape(interval)
	if err := s.get(ctx, path, query, &dtos); err != nil {
		return nil, err
	}

	out := make([]Kline, 0, len(dtos))
	for _, d := range dtos {
		out = append(out, Kline{
			OpenTime: d.OpenTime,
			Open:     d.Open,
			High:     d.High,
			Low:      d.Low,
			Close:    d.Close,
			Volume:   d.Volume,
		})
	}
	return out, nil
}

// Pairs returns the listed markets and their trading metadata.
func (s *HTTPSource) Pairs(ctx context.Context) ([]*PairConfig, error) {
	var dtos []symbolInfoDTO
	if err := s.get(ctx, "/api/v1/symbols", nil, &dtos); err != nil {
		return nil, err
	}

	out := make([]*PairConfig, 0, len(dtos))
	for _, d := range dtos {
		out = append(out, &PairConfig{
			Symbol:      d.Symbol,
			BaseAsset:   d.BaseAsset,
			QuoteAsset:  d.QuoteAsset,
			Status:      d.Status,
			MinPrice:    d.MinPrice,
			MaxPrice:    d.MaxPrice,
			TickSize:    d.TickSize,
			MinQuantity: d.MinQuantity,
			MaxQuantity: d.MaxQuantity,
			StepSize:    d.StepSize,
		})
	}
	return out, nil
}
