package exchange

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"tigerex/backend/internal/api"
)

// ErrOrderNotCancelable is returned when an order is already terminal.
var ErrOrderNotCancelable = errors.New("order is not cancelable")

// OrderRequest is a placement request from the HTTP layer.
type OrderRequest struct {
	UserID        string
	Symbol        string
	Side          string
	Type          string
	Quantity      float64
	Price         float64
	StopPrice     float64
	TimeInForce   string
	ClientOrderID string
	ReduceOnly    bool
}

// PlaceOrder validates an order against its market, locks the funds it would
// need, and persists it as a resting order. The funds are locked in the same
// transaction that writes the order, so a crash cannot leave a locked balance
// with no order or an order with no locked balance. Matching is performed by the
// canonical engine; this store never fabricates a fill.
func (s *Store) PlaceOrder(ctx context.Context, req *OrderRequest) (*api.Order, error) {
	if err := s.ready(); err != nil {
		return nil, err
	}
	if req == nil || !isUUID(req.UserID) || strings.TrimSpace(req.Symbol) == "" {
		return nil, ErrInvalidInput
	}
	if !finite(req.Quantity) || req.Quantity <= 0 {
		return nil, ErrInvalidInput
	}
	side := strings.ToLower(strings.TrimSpace(req.Side))
	if side != "buy" && side != "sell" {
		return nil, ErrInvalidInput
	}
	orderType := strings.ToLower(strings.TrimSpace(req.Type))
	if orderType == "" {
		orderType = "limit"
	}
	switch orderType {
	case "market":
	case "limit":
		if !finite(req.Price) || req.Price <= 0 {
			return nil, ErrInvalidInput
		}
	case "stop_loss", "stop_limit":
		if !finite(req.StopPrice) || req.StopPrice <= 0 {
			return nil, ErrInvalidInput
		}
		if orderType == "stop_limit" && (!finite(req.Price) || req.Price <= 0) {
			return nil, ErrInvalidInput
		}
	default:
		return nil, ErrInvalidInput
	}

	symbol := strings.ToUpper(req.Symbol)
	market, err := s.GetMarket(ctx, symbol)
	if err != nil {
		return nil, err
	}
	if !strings.EqualFold(market.Status, "trading") {
		return nil, fmt.Errorf("market %s is not trading", symbol)
	}
	if req.Quantity < market.MinQuantity {
		return nil, fmt.Errorf("quantity below minimum %v", market.MinQuantity)
	}

	// Determine the asset and amount to lock. A buy reserves quote currency, a
	// sell reserves base currency.
	var lockAsset string
	var lockAmount float64
	if side == "buy" {
		lockAsset = market.QuoteAsset
		price := req.Price
		if orderType == "market" {
			price, err = s.lastPrice(ctx, symbol)
			if err != nil {
				return nil, err
			}
		}
		lockAmount = price * req.Quantity
	} else {
		lockAsset = market.BaseAsset
		lockAmount = req.Quantity
	}
	if market.MinNotional > 0 && side == "buy" && lockAmount < market.MinNotional {
		return nil, fmt.Errorf("order notional below minimum %v", market.MinNotional)
	}

	tif := strings.ToUpper(strings.TrimSpace(req.TimeInForce))
	if tif == "" {
		tif = "GTC"
	}

	var order *api.Order
	err = s.withTx(ctx, func(tx pgx.Tx) error {
		if err := ensureWalletLocked(ctx, tx, req.UserID, lockAsset, "main"); err != nil {
			return err
		}
		remaining, err := moveAvailableToLocked(ctx, tx, req.UserID, lockAsset, lockAmount, "order_lock")
		if err != nil {
			return err
		}
		if remaining > 0 {
			return ErrInsufficientFunds
		}

		var price, stopPrice interface{}
		if req.Price > 0 {
			price = decString(toDec(req.Price))
		}
		if req.StopPrice > 0 {
			stopPrice = decString(toDec(req.StopPrice))
		}
		var clientOrderID interface{}
		if req.ClientOrderID != "" {
			clientOrderID = req.ClientOrderID
		}

		row := tx.QueryRow(ctx, `
			INSERT INTO orders
				(user_id, market_id, symbol, side, type, price, stop_price, quantity,
				 status, time_in_force, client_order_id, reduce_only,
				 reserved_amount, reserved_asset)
			VALUES ($1, (SELECT id FROM markets WHERE symbol = $2::text), $2, $3, $4, $5, $6, $7,
			        'new', $8, $9, $10, $11, $12)
			RETURNING id, user_id, symbol, side, type,
			          COALESCE(price,0)::float8, COALESCE(stop_price,0)::float8,
			          quantity::float8, filled_quantity::float8, status,
			          time_in_force, COALESCE(client_order_id,''),
			          EXTRACT(EPOCH FROM created_at)::bigint,
			          EXTRACT(EPOCH FROM updated_at)::bigint`,
			req.UserID, symbol, side, orderType, price,
			stopPrice, decString(toDec(req.Quantity)), tif, clientOrderID, req.ReduceOnly,
			decString(toDec(lockAmount)), lockAsset)
		order, err = scanOrder(row)
		if err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return order, nil
}

// GetOrders returns a user's orders, optionally filtered by symbol and status.
func (s *Store) GetOrders(ctx context.Context, userID, symbol, side, status string, limit int) ([]api.Order, error) {
	if err := s.ready(); err != nil {
		return nil, err
	}
	if !isUUID(userID) {
		return nil, ErrInvalidInput
	}
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, user_id, symbol, side, type,
		       COALESCE(price,0)::float8, COALESCE(stop_price,0)::float8,
		       quantity::float8, filled_quantity::float8, status,
		       time_in_force, COALESCE(client_order_id,''),
		       EXTRACT(EPOCH FROM created_at)::bigint,
		       EXTRACT(EPOCH FROM updated_at)::bigint
		  FROM orders
		 WHERE user_id = $1
		   AND ($2 = '' OR symbol = $2)
		   AND ($3 = '' OR side = $3)
		   AND ($4 = '' OR status = $4)
		 ORDER BY created_at DESC
		 LIMIT $5`, userID, strings.ToUpper(symbol), strings.ToLower(side), strings.ToLower(status), limit)
	if err != nil {
		return nil, fmt.Errorf("get orders: %w", err)
	}
	defer rows.Close()

	orders := []api.Order{}
	for rows.Next() {
		o, err := scanOrder(rows)
		if err != nil {
			return nil, err
		}
		orders = append(orders, *o)
	}
	return orders, rows.Err()
}

// GetOrder returns a single order belonging to the user.
func (s *Store) GetOrder(ctx context.Context, userID, orderID string) (*api.Order, error) {
	if err := s.ready(); err != nil {
		return nil, err
	}
	if !isUUID(userID) || !isUUID(orderID) {
		return nil, ErrInvalidInput
	}
	row := s.pool.QueryRow(ctx, `
		SELECT id, user_id, symbol, side, type,
		       COALESCE(price,0)::float8, COALESCE(stop_price,0)::float8,
		       quantity::float8, filled_quantity::float8, status,
		       time_in_force, COALESCE(client_order_id,''),
		       EXTRACT(EPOCH FROM created_at)::bigint,
		       EXTRACT(EPOCH FROM updated_at)::bigint
		  FROM orders WHERE id = $1 AND user_id = $2`, orderID, userID)
	o, err := scanOrder(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return o, err
}

// CancelOrder cancels a resting order and releases the funds it locked.
func (s *Store) CancelOrder(ctx context.Context, userID, orderID string) (*api.Order, error) {
	if err := s.ready(); err != nil {
		return nil, err
	}
	if !isUUID(userID) || !isUUID(orderID) {
		return nil, ErrInvalidInput
	}
	var order *api.Order
	err := s.withTx(ctx, func(tx pgx.Tx) error {
		row := tx.QueryRow(ctx, `
			SELECT id, user_id, symbol, side, type,
			       COALESCE(price,0)::float8, COALESCE(stop_price,0)::float8,
			       quantity::float8, filled_quantity::float8, status,
			       time_in_force, COALESCE(client_order_id,''),
			       EXTRACT(EPOCH FROM created_at)::bigint,
			       EXTRACT(EPOCH FROM updated_at)::bigint
			  FROM orders WHERE id = $1 AND user_id = $2
			  FOR UPDATE`, orderID, userID)
		o, err := scanOrder(row)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if o.Status != "new" && o.Status != "partially_filled" && o.Status != "pending" {
			return ErrOrderNotCancelable
		}

		// Release exactly the reservation the order still holds. Settlement has
		// already decremented it by every fill, so recomputing the amount from the
		// order price would strand or over-release a partially filled order.
		var reservedAsset string
		var reserved float64
		if err := tx.QueryRow(ctx, `
			SELECT COALESCE(reserved_asset,''), COALESCE(reserved_amount,0)::float8
			  FROM orders WHERE id = $1`, orderID).Scan(&reservedAsset, &reserved); err != nil {
			return err
		}
		if reserved > 0 && reservedAsset != "" {
			if err := unlockTx(ctx, tx, userID, reservedAsset, reserved, "order_cancel"); err != nil {
				return err
			}
		}

		if _, err := tx.Exec(ctx, `
			UPDATE orders SET status = 'canceled', reserved_amount = 0, updated_at = NOW()
			 WHERE id = $1`, orderID); err != nil {
			return fmt.Errorf("cancel order: %w", err)
		}
		o.Status = "canceled"
		order = o
		return nil
	})
	if err != nil {
		return nil, err
	}
	return order, nil
}

// CancelAllOrders cancels every open order for a user, optionally on one symbol.
func (s *Store) CancelAllOrders(ctx context.Context, userID, symbol string) ([]api.Order, error) {
	if err := s.ready(); err != nil {
		return nil, err
	}
	open, err := s.GetOrders(ctx, userID, symbol, "", "new", 1000)
	if err != nil {
		return nil, err
	}
	canceled := []api.Order{}
	for _, o := range open {
		c, err := s.CancelOrder(ctx, userID, o.ID)
		if err != nil {
			return canceled, err
		}
		canceled = append(canceled, *c)
	}
	return canceled, nil
}

// GetUserTrades returns the user's own fills, newest first.
func (s *Store) GetUserTrades(ctx context.Context, userID, symbol string, limit int) ([]api.Trade, error) {
	if err := s.ready(); err != nil {
		return nil, err
	}
	if !isUUID(userID) {
		return nil, ErrInvalidInput
	}
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	rows, err := s.pool.Query(ctx, `
		SELECT t.id, t.order_id, t.symbol, t.side, t.price::float8,
		       t.quantity::float8, t.fee::float8, COALESCE(t.fee_asset,''),
		       t.maker, EXTRACT(EPOCH FROM t.created_at)::bigint
		  FROM trades t
		  JOIN orders o ON o.id = t.order_id
		 WHERE o.user_id = $1
		   AND ($2 = '' OR t.symbol = $2)
		 ORDER BY t.created_at DESC
		 LIMIT $3`, userID, strings.ToUpper(symbol), limit)
	if err != nil {
		return nil, fmt.Errorf("get user trades: %w", err)
	}
	defer rows.Close()

	trades := []api.Trade{}
	for rows.Next() {
		var t api.Trade
		if err := rows.Scan(&t.ID, &t.OrderID, &t.Symbol, &t.Side, &t.Price,
			&t.Quantity, &t.Fee, &t.FeeAsset, &t.Maker, &t.Timestamp); err != nil {
			return nil, err
		}
		trades = append(trades, t)
	}
	return trades, rows.Err()
}

// lastPrice returns the most recent trade price for a symbol, used to size the
// reservation for a market buy. It fails closed when the market has never
// traded, rather than assuming a price.
func (s *Store) lastPrice(ctx context.Context, symbol string) (float64, error) {
	if err := s.ready(); err != nil {
		return 0, err
	}
	var price float64
	err := s.pool.QueryRow(ctx, `
		SELECT price::float8 FROM trades WHERE symbol = $1
		 ORDER BY created_at DESC LIMIT 1`, symbol).Scan(&price)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, fmt.Errorf("%w: %s has no trades to price a market order", ErrNotFound, symbol)
	}
	if err != nil {
		return 0, err
	}
	return price, nil
}

func (s *Store) getMarketTx(ctx context.Context, tx pgx.Tx, symbol string) (*api.Market, error) {
	if err := s.ready(); err != nil {
		return nil, err
	}
	var m api.Market
	err := tx.QueryRow(ctx, `
		SELECT symbol, base_asset, quote_asset, status,
		       min_price::float8, COALESCE(max_price,0)::float8,
		       min_quantity::float8, COALESCE(max_quantity,0)::float8,
		       min_notional::float8, step_size::float8, precision
		  FROM markets WHERE symbol = $1`, symbol).
		Scan(&m.Symbol, &m.BaseAsset, &m.QuoteAsset, &m.Status, &m.MinPrice,
			&m.MaxPrice, &m.MinQuantity, &m.MaxQuantity, &m.MinNotional,
			&m.StepSize, &m.Precision)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &m, nil
}

// unlockTx returns locked funds to available inside an existing transaction.
func unlockTx(ctx context.Context, tx pgx.Tx, userID, asset string, amount float64, reference string) error {
	rows, err := tx.Query(ctx, `
		SELECT network, locked::float8 FROM wallets
		 WHERE user_id = $1 AND asset = $2 AND locked > 0
		 ORDER BY network FOR UPDATE`, userID, asset)
	if err != nil {
		return err
	}
	type bal struct {
		network string
		locked  float64
	}
	var balances []bal
	for rows.Next() {
		var b bal
		if err := rows.Scan(&b.network, &b.locked); err != nil {
			rows.Close()
			return err
		}
		balances = append(balances, b)
	}
	rows.Close()

	remaining := amount
	for _, b := range balances {
		if remaining <= 0 {
			break
		}
		take := b.locked
		if take > remaining {
			take = remaining
		}
		var available, locked float64
		err := tx.QueryRow(ctx, `
			UPDATE wallets
			   SET locked = locked - $3, available = available + $3, updated_at = NOW()
			 WHERE user_id = $1 AND asset = $2 AND network = $4
			 RETURNING available::float8, locked::float8`,
			userID, asset, decString(toDec(take)), b.network).Scan(&available, &locked)
		if err != nil {
			return err
		}
		if err := recordLedger(ctx, tx, userID, asset, b.network, "unlock", take, available, locked, reference); err != nil {
			return err
		}
		remaining -= take
	}
	return nil
}

// rowScanner is satisfied by both pgx.Row and pgx.Rows.
type rowScanner interface {
	Scan(dest ...interface{}) error
}

func scanOrder(row rowScanner) (*api.Order, error) {
	var o api.Order
	err := row.Scan(&o.ID, &o.UserID, &o.Symbol, &o.Side, &o.Type, &o.Price,
		&o.StopPrice, &o.Quantity, &o.FilledQuantity, &o.Status, &o.TimeInForce,
		&o.ClientOrderID, &o.CreatedAt, &o.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &o, nil
}
