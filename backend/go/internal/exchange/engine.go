package exchange

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"tigerex/backend/internal/api"
	"tigerex/backend/internal/matching"
)

// WithEngine attaches the canonical matching engine. Without it, order
// placement fails closed with ErrUnavailable instead of resting an order that
// can never trade.
func (s *Store) WithEngine(c *matching.Client) *Store {
	s.engine = c
	return s
}

// Engine returns the attached engine client, or nil when unconfigured.
func (s *Store) Engine() *matching.Client {
	if s == nil {
		return nil
	}
	return s.engine
}

// marketSpec reads the full definition the engine needs for a symbol.
func (s *Store) marketSpec(ctx context.Context, symbol string) (*matching.MarketSpec, error) {
	if err := s.ready(); err != nil {
		return nil, err
	}
	symbol = strings.ToUpper(symbol)
	var (
		m                               matching.MarketSpec
		makerFee, takerFee, minNotional float64
	)
	err := s.pool.QueryRow(ctx, `
		SELECT symbol, base_asset, quote_asset, status, precision,
		       min_quantity::float8, COALESCE(max_quantity,0)::float8,
		       min_price::float8, COALESCE(max_price,0)::float8,
		       step_size::float8, maker_fee::float8, taker_fee::float8,
		       min_notional::float8
		  FROM markets WHERE symbol = $1`, symbol).
		Scan(&m.ID, &m.BaseAsset, &m.QuoteAsset, &m.Status, &m.PricePrecision,
			&m.MinQuantity, &m.MaxQuantity, &m.MinPrice, &m.MaxPrice,
			&m.StepSize, &makerFee, &takerFee, &minNotional)
	if err != nil {
		return nil, fmt.Errorf("read market %s: %w", symbol, err)
	}
	m.QuantityPrecision = m.PricePrecision
	m.TickSize = m.StepSize
	m.MakerFee = makerFee
	m.TakerFee = takerFee
	m.MinNotional = minNotional
	m.TradingEnabled = strings.EqualFold(m.Status, "active") || strings.EqualFold(m.Status, "trading")

	// The engine validates strictly, so an unset bound in the database (NULL
	// reads back as zero) would reject every order. Give the engine the widest
	// bound the schema allows rather than an unusable zero.
	if m.MaxQuantity <= 0 {
		m.MaxQuantity = 1e15
	}
	if m.MaxPrice <= 0 {
		m.MaxPrice = 1e15
	}
	if m.MinPrice < 0 {
		m.MinPrice = 0
	}
	if m.MinQuantity <= 0 {
		m.MinQuantity = 1e-8
	}
	if m.StepSize <= 0 {
		m.StepSize = 1e-8
	}
	if m.TickSize <= 0 {
		m.TickSize = 1e-8
	}
	return &m, nil
}

// LoadMarketsIntoEngine registers every listed market with the engine. It is
// idempotent and is called at boot so the engine knows the same instruments the
// database advertises.
func (s *Store) LoadMarketsIntoEngine(ctx context.Context) error {
	if s.engine == nil {
		return nil
	}
	markets, err := s.ListMarkets(ctx)
	if err != nil {
		return err
	}
	for _, mk := range markets {
		spec, err := s.marketSpec(ctx, mk.Symbol)
		if err != nil {
			return err
		}
		if err := s.engine.AddMarket(ctx, *spec); err != nil {
			return fmt.Errorf("register %s with engine: %w", mk.Symbol, err)
		}
	}
	return nil
}

// ReplayOpenOrders rebuilds the engine's book from resting orders in the
// database. The engine holds its book in memory, so without this a restart
// would silently drop every open order and its locked funds would be
// unreachable. Orders are replayed oldest first so price-time priority is
// preserved.
func (s *Store) ReplayOpenOrders(ctx context.Context) error {
	if s.engine == nil {
		return nil
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, user_id, symbol, side, type,
		       COALESCE(price,0)::float8,
		       (quantity - filled_quantity)::float8
		  FROM orders
		 WHERE status IN ('new', 'partially_filled')
		   AND type = 'limit'
		   AND price IS NOT NULL
		   AND quantity > filled_quantity
		 ORDER BY created_at ASC, id ASC`)
	if err != nil {
		return fmt.Errorf("read open orders: %w", err)
	}
	defer rows.Close()

	type open struct {
		id, userID, symbol, side, orderType string
		price, remaining                    float64
	}
	var opens []open
	for rows.Next() {
		var o open
		if err := rows.Scan(&o.id, &o.userID, &o.symbol, &o.side, &o.orderType,
			&o.price, &o.remaining); err != nil {
			return fmt.Errorf("scan open order: %w", err)
		}
		opens = append(opens, o)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, o := range opens {
		_, err := s.engine.PlaceOrder(ctx, matching.OrderSpec{
			ID:        o.id,
			UserID:    o.userID,
			Market:    strings.ToUpper(o.symbol),
			Side:      strings.ToLower(o.side),
			OrderType: "limit",
			Price:     o.price,
			Quantity:  o.remaining,
		})
		if err != nil {
			return fmt.Errorf("replay order %s: %w", o.id, err)
		}
	}
	return nil
}

// SubmitToEngine sends an already-persisted order to the engine and returns the
// executions it produced.
func (s *Store) SubmitToEngine(ctx context.Context, orderID, userID, symbol, side, orderType string, price, quantity float64) ([]matching.Trade, error) {
	if s.engine == nil {
		return nil, ErrUnavailable
	}
	return s.engine.PlaceOrder(ctx, matching.OrderSpec{
		ID:        orderID,
		UserID:    userID,
		Market:    strings.ToUpper(symbol),
		Side:      strings.ToLower(side),
		OrderType: strings.ToLower(orderType),
		Price:     price,
		Quantity:  quantity,
	})
}

// CancelInEngine removes an order from the engine's book. A missing order is not
// an error here: the order may already be fully filled, in which case the
// database is the authority.
func (s *Store) CancelInEngine(ctx context.Context, orderID string) {
	if s.engine == nil {
		return
	}
	if err := s.engine.CancelOrder(ctx, orderID); err != nil && err != matching.ErrUnavailable {
		// The order is gone from the engine's book; the database cancel is
		// still authoritative.
		_ = err
	}
}

// EngineDepth returns the engine's aggregated visible book for a market.
func (s *Store) EngineDepth(ctx context.Context, symbol string, limit int) (*matching.DepthSnapshot, error) {
	if s.engine == nil {
		return nil, ErrUnavailable
	}
	return s.engine.Depth(ctx, strings.ToUpper(symbol), limit)
}

// EngineOrderBook returns the live book as the API order-book shape. The engine
// is authoritative for the resting book, so this reflects the true price-time
// priority and never leaks an iceberg's withheld size.
func (s *Store) EngineOrderBook(ctx context.Context, symbol string, limit int) (*api.OrderBook, error) {
	snap, err := s.EngineDepth(ctx, symbol, limit)
	if err != nil {
		return nil, err
	}
	book := &api.OrderBook{Bids: [][]string{}, Asks: [][]string{}}
	for _, lvl := range snap.Bids {
		if lvl.Quantity <= 0 {
			continue
		}
		book.Bids = append(book.Bids, []string{formatDecimal(lvl.Price), formatDecimal(lvl.Quantity)})
	}
	for _, lvl := range snap.Asks {
		if lvl.Quantity <= 0 {
			continue
		}
		book.Asks = append(book.Asks, []string{formatDecimal(lvl.Price), formatDecimal(lvl.Quantity)})
	}
	return book, nil
}

// PlaceOrderAndMatch persists an order, submits it to the canonical engine and
// settles whatever it matched, all in one call. The database reservation is the
// source of truth: if the engine rejects the order, the reservation is released
// and the order is marked rejected, so a failed submission never strands funds.
func (s *Store) PlaceOrderAndMatch(ctx context.Context, req *OrderRequest) (*api.Order, error) {
	if s == nil || s.engine == nil {
		return nil, ErrUnavailable
	}
	order, err := s.PlaceOrder(ctx, req)
	if err != nil {
		return nil, err
	}

	// A stop order rests off-book until its trigger; the engine only prices
	// plain limit and market orders.
	if order.Type == "stop_loss" || order.Type == "stop_limit" || order.Type == "trailing_stop" {
		return order, nil
	}

	trades, err := s.SubmitToEngine(ctx, order.ID, order.UserID, order.Symbol, order.Side, order.Type, order.Price, order.Quantity)
	if err != nil {
		// Release the reservation and record the rejection. A market order that
		// the engine could not fill must not keep the trader's funds locked.
		if rerr := s.rejectAndRelease(ctx, order.ID); rerr != nil {
			return nil, fmt.Errorf("engine rejected order %s (%v) and releasing its funds failed: %w", order.ID, err, rerr)
		}
		return nil, err
	}

	if len(trades) > 0 {
		fills := fillsFromTrades(order.Symbol, order.ID, order.UserID, order.Side, trades)
		if err := s.SettleFills(ctx, fills); err != nil {
			return nil, err
		}
	}
	// Reload so the caller sees the settled status and filled quantity.
	updated, err := s.GetOrder(ctx, order.UserID, order.ID)
	if err != nil {
		return order, nil
	}
	return updated, nil
}

// rejectAndRelease releases an order's remaining reservation and marks it
// rejected, in one transaction. It is used when the engine refuses an order
// outright; the funds it had locked must become available again and the order
// must not be left looking cancelable or open.
func (s *Store) rejectAndRelease(ctx context.Context, orderID string) error {
	return s.withTx(ctx, func(tx pgx.Tx) error {
		var userID, reservedAsset string
		var reserved float64
		err := tx.QueryRow(ctx, `
			SELECT user_id, COALESCE(reserved_asset,''), COALESCE(reserved_amount,0)::float8
			  FROM orders WHERE id = $1 FOR UPDATE`, orderID).Scan(&userID, &reservedAsset, &reserved)
		if err != nil {
			return err
		}
		if reserved > 0 && reservedAsset != "" {
			if err := unlockTx(ctx, tx, userID, reservedAsset, reserved, "order_reject"); err != nil {
				return err
			}
		}
		_, err = tx.Exec(ctx, `
			UPDATE orders SET status = 'rejected', reserved_amount = 0, updated_at = NOW()
			 WHERE id = $1`, orderID)
		return err
	})
}

// fillsFromTrades maps engine trades to the settlement side of the ledger.
// `takerOrderID`/`takerUserID`/`takerSide` describe the incoming order; each
// trade names the resting (maker) order that supplied liquidity.
func fillsFromTrades(symbol, takerOrderID, takerUserID, takerSide string, trades []matching.Trade) []Fill {
	fills := make([]Fill, 0, len(trades))
	for _, t := range trades {
		f := Fill{
			TradeID:      t.ID,
			Symbol:       symbol,
			Price:        t.Price,
			Quantity:     t.Quantity,
			TakerUserID:  takerUserID,
			TakerOrderID: takerOrderID,
			TakerSide:    takerSide,
			MakerOrderID: t.OrderID,
		}
		if strings.EqualFold(takerSide, "buy") {
			f.MakerUserID = t.SellerUserID
		} else {
			f.MakerUserID = t.BuyerUserID
		}
		fills = append(fills, f)
	}
	return fills
}
