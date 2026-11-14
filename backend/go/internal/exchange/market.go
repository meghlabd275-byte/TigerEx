package exchange

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"tigerex/backend/internal/api"
)

// ErrNotFound is returned when a symbol or row does not exist.
var ErrNotFound = errors.New("not found")

// intervalSeconds maps the interval strings the API accepts to their length.
// An unknown interval is rejected rather than silently bucketed at a default.
var intervalSeconds = map[string]int64{
	"1m":  60,
	"3m":  180,
	"5m":  300,
	"15m": 900,
	"30m": 1800,
	"1h":  3600,
	"2h":  7200,
	"4h":  14400,
	"6h":  21600,
	"8h":  28800,
	"12h": 43200,
	"1d":  86400,
	"3d":  259200,
	"1w":  604800,
}

// ListMarkets returns every tradable market from the database.
func (s *Store) ListMarkets(ctx context.Context) ([]api.Market, error) {
	if err := s.ready(); err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `
		SELECT symbol, base_asset, quote_asset, status,
		       min_price::float8, COALESCE(max_price, 0)::float8,
		       min_quantity::float8, COALESCE(max_quantity, 0)::float8,
		       min_notional::float8, step_size::float8, precision
		  FROM markets
		 ORDER BY symbol`)
	if err != nil {
		return nil, fmt.Errorf("list markets: %w", err)
	}
	defer rows.Close()

	var markets []api.Market
	for rows.Next() {
		var m api.Market
		if err := rows.Scan(&m.Symbol, &m.BaseAsset, &m.QuoteAsset, &m.Status,
			&m.MinPrice, &m.MaxPrice, &m.MinQuantity, &m.MaxQuantity,
			&m.MinNotional, &m.StepSize, &m.Precision); err != nil {
			return nil, fmt.Errorf("scan market: %w", err)
		}
		markets = append(markets, m)
	}
	return markets, rows.Err()
}

// GetMarket returns a single market by symbol.
func (s *Store) GetMarket(ctx context.Context, symbol string) (*api.Market, error) {
	if err := s.ready(); err != nil {
		return nil, err
	}
	var m api.Market
	err := s.pool.QueryRow(ctx, `
		SELECT symbol, base_asset, quote_asset, status,
		       min_price::float8, COALESCE(max_price, 0)::float8,
		       min_quantity::float8, COALESCE(max_quantity, 0)::float8,
		       min_notional::float8, step_size::float8, precision
		  FROM markets WHERE symbol = $1`, strings.ToUpper(symbol)).
		Scan(&m.Symbol, &m.BaseAsset, &m.QuoteAsset, &m.Status,
			&m.MinPrice, &m.MaxPrice, &m.MinQuantity, &m.MaxQuantity,
			&m.MinNotional, &m.StepSize, &m.Precision)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get market: %w", err)
	}
	return &m, nil
}

// ExchangeInfo reports live exchange metadata. The status is "operational" only
// because this reads from storage; a database error propagates instead.
func (s *Store) ExchangeInfo(ctx context.Context) (*api.ExchangeInfo, error) {
	if err := s.ready(); err != nil {
		return nil, err
	}
	markets, err := s.ListMarkets(ctx)
	if err != nil {
		return nil, err
	}
	return &api.ExchangeInfo{
		Timezone:       "UTC",
		ServerTime:     api.Now(),
		ExchangeStatus: "operational",
		Symbols:        markets,
	}, nil
}

// Ticker24h computes 24-hour statistics for a symbol from the settled trade tape.
// A market that has not traded in the window reports a null price (represented
// as a zero-value ticker) rather than a seeded quote.
func (s *Store) Ticker24h(ctx context.Context, symbol string) (*api.Ticker, error) {
	if err := s.ready(); err != nil {
		return nil, err
	}
	symbol = strings.ToUpper(symbol)
	if _, err := s.GetMarket(ctx, symbol); err != nil {
		return nil, err
	}

	var (
		last, first, high, low, volume, quoteVolume float64
		count                                       int
	)
	err := s.pool.QueryRow(ctx, `
		WITH windowed AS (
			SELECT price::float8 AS price, quantity::float8 AS qty, created_at
			  FROM trades
			 WHERE symbol = $1 AND created_at >= NOW() - INTERVAL '24 hours'
		)
		SELECT
			COALESCE((SELECT price FROM windowed ORDER BY created_at DESC LIMIT 1), 0),
			COALESCE((SELECT price FROM windowed ORDER BY created_at ASC  LIMIT 1), 0),
			COALESCE((SELECT MAX(price) FROM windowed), 0),
			COALESCE((SELECT MIN(price) FROM windowed), 0),
			COALESCE((SELECT SUM(qty) FROM windowed), 0),
			COALESCE((SELECT SUM(qty * price) FROM windowed), 0),
			(SELECT COUNT(*) FROM windowed)`, symbol).
		Scan(&last, &first, &high, &low, &volume, &quoteVolume, &count)
	if err != nil {
		return nil, fmt.Errorf("ticker24h: %w", err)
	}

	t := &api.Ticker{
		Symbol:      symbol,
		Price:       last,
		Volume:      volume,
		QuoteVolume: quoteVolume,
		High:        high,
		Low:         low,
		Timestamp:   api.Now(),
	}
	if count > 0 && first > 0 {
		t.PriceChange = last - first
		t.PriceChangePct = (last - first) / first * 100
	}
	return t, nil
}

// OrderBook aggregates resting orders into price levels. Bids come from buy
// orders, asks from sell orders; only open orders are included.
func (s *Store) OrderBook(ctx context.Context, symbol string, limit int) (*api.OrderBook, error) {
	if err := s.ready(); err != nil {
		return nil, err
	}
	symbol = strings.ToUpper(symbol)
	if _, err := s.GetMarket(ctx, symbol); err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 1000 {
		limit = 100
	}

	rows, err := s.pool.Query(ctx, `
		SELECT side, price::float8, SUM(quantity - filled_quantity)::float8 AS qty
		  FROM orders
		 WHERE symbol = $1
		   AND status IN ('new', 'partially_filled')
		   AND price IS NOT NULL
		 GROUP BY side, price
		 ORDER BY price DESC`, symbol)
	if err != nil {
		return nil, fmt.Errorf("order book: %w", err)
	}
	defer rows.Close()

	book := &api.OrderBook{Bids: [][]string{}, Asks: [][]string{}}
	for rows.Next() {
		var side string
		var price, qty float64
		if err := rows.Scan(&side, &price, &qty); err != nil {
			return nil, fmt.Errorf("scan book level: %w", err)
		}
		if qty <= 0 {
			continue
		}
		level := []string{formatDecimal(price), formatDecimal(qty)}
		if strings.EqualFold(side, "buy") {
			if len(book.Bids) < limit {
				book.Bids = append(book.Bids, level)
			}
		} else {
			if len(book.Asks) < limit {
				book.Asks = append(book.Asks, level)
			}
		}
	}
	// Asks were scanned descending; present them ascending like a real book.
	reverse(book.Asks)
	return book, rows.Err()
}

// RecentTrades returns the most recent public trades for a symbol, newest last.
func (s *Store) RecentTrades(ctx context.Context, symbol string, limit int, fromID int64) ([]api.Trade, error) {
	if err := s.ready(); err != nil {
		return nil, err
	}
	symbol = strings.ToUpper(symbol)
	if _, err := s.GetMarket(ctx, symbol); err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, order_id, symbol, side, price::float8, quantity::float8,
		       fee::float8, COALESCE(fee_asset, ''), maker,
		       EXTRACT(EPOCH FROM created_at)::bigint
		  FROM trades
		 WHERE symbol = $1
		 ORDER BY created_at DESC
		 LIMIT $2`, symbol, limit)
	if err != nil {
		return nil, fmt.Errorf("recent trades: %w", err)
	}
	defer rows.Close()

	trades := []api.Trade{}
	for rows.Next() {
		var t api.Trade
		if err := rows.Scan(&t.ID, &t.OrderID, &t.Symbol, &t.Side, &t.Price,
			&t.Quantity, &t.Fee, &t.FeeAsset, &t.Maker, &t.Timestamp); err != nil {
			return nil, fmt.Errorf("scan trade: %w", err)
		}
		trades = append(trades, t)
	}
	return trades, rows.Err()
}

// Klines aggregates settled trades into candlesticks for the requested interval.
func (s *Store) Klines(ctx context.Context, symbol, interval string, startTime, endTime int64, limit int) ([]api.KLine, error) {
	if err := s.ready(); err != nil {
		return nil, err
	}
	symbol = strings.ToUpper(symbol)
	if _, err := s.GetMarket(ctx, symbol); err != nil {
		return nil, err
	}
	step, ok := intervalSeconds[strings.ToLower(interval)]
	if !ok {
		return nil, fmt.Errorf("unsupported interval %q", interval)
	}
	if limit <= 0 || limit > 1500 {
		limit = 500
	}
	if endTime == 0 {
		endTime = time.Now().Unix()
	}
	if startTime == 0 {
		startTime = endTime - step*int64(limit)
	}

	rows, err := s.pool.Query(ctx, `
		SELECT
			(FLOOR(EXTRACT(EPOCH FROM created_at) / $3) * $3)::bigint AS bucket,
			(array_agg(price::float8 ORDER BY created_at ASC))[1]  AS open,
			MAX(price::float8) AS high,
			MIN(price::float8) AS low,
			(array_agg(price::float8 ORDER BY created_at DESC))[1] AS close,
			SUM(quantity::float8) AS volume
		  FROM trades
		 WHERE symbol = $1
		   AND created_at >= to_timestamp($2)
		   AND created_at <= to_timestamp($4)
		 GROUP BY bucket
		 ORDER BY bucket ASC
		 LIMIT $5`, symbol, startTime, step, endTime, limit)
	if err != nil {
		return nil, fmt.Errorf("klines: %w", err)
	}
	defer rows.Close()

	klines := []api.KLine{}
	for rows.Next() {
		var k api.KLine
		if err := rows.Scan(&k.OpenTime, &k.Open, &k.High, &k.Low, &k.Close, &k.Volume); err != nil {
			return nil, fmt.Errorf("scan kline: %w", err)
		}
		k.CloseTime = k.OpenTime + step
		klines = append(klines, k)
	}
	return klines, rows.Err()
}

func reverse(levels [][]string) {
	for i, j := 0, len(levels)-1; i < j; i, j = i+1, j-1 {
		levels[i], levels[j] = levels[j], levels[i]
	}
}
