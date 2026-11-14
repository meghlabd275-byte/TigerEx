package exchange

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

// Fill is one execution produced by the matching engine that must be settled
// against real balances. The engine reports the resting (maker) order and the
// taker's side; the caller supplies the taker's own order id and user.
type Fill struct {
	TradeID      string
	Symbol       string
	Price        float64
	Quantity     float64
	TakerUserID  string
	TakerOrderID string
	TakerSide    string // "buy" | "sell"
	MakerUserID  string
	MakerOrderID string
}

// orderLock is the subset of an order row settlement needs.
type orderLock struct {
	id            string
	userID        string
	side          string
	orderType     string
	reserved      float64
	reservedAsset string
	filled        float64
	quantity      float64
}

// SettleFills applies the engine's executions to real balances in one atomic
// transaction, so a crash cannot settle half a batch. For every fill it:
//
//   - pays the buyer's quote out of the funds the buy order reserved,
//   - pays the seller's base out of the funds the sell order reserved,
//   - credits the seller the quote proceeds and the buyer the base received,
//   - withholds each side's fee from what that side receives and books it to the
//     venue's fee account, so the fee is taken from value actually moved and the
//     two legs always balance.
//
// It then updates each order's filled quantity and outstanding reservation and
// releases whatever reservation remains on an order that has become terminal.
func (s *Store) SettleFills(ctx context.Context, fills []Fill) error {
	if err := s.ready(); err != nil {
		return err
	}
	if len(fills) == 0 {
		return nil
	}
	for _, f := range fills {
		if !isUUID(f.TakerOrderID) || !isUUID(f.MakerOrderID) {
			return ErrInvalidInput
		}
		if !finite(f.Price) || f.Price <= 0 || !finite(f.Quantity) || f.Quantity <= 0 {
			return ErrInvalidInput
		}
	}

	// Settling touches several wallet rows; a concurrent settlement can pick the
	// rows in another order and deadlock. Deadlocks and serialization failures
	// are transient, so retry them.
	return withRetry(ctx, 5, func() error {
		return s.settleFillsOnce(ctx, fills)
	})
}

func (s *Store) settleFillsOnce(ctx context.Context, fills []Fill) error {
	return s.withTx(ctx, func(tx pgx.Tx) error {
		// Lock every involved order up front, in id order, so two settlements
		// that share a maker cannot deadlock on the order rows.
		ids := map[string]bool{}
		for _, f := range fills {
			ids[f.TakerOrderID] = true
			ids[f.MakerOrderID] = true
		}
		ordered := make([]string, 0, len(ids))
		for id := range ids {
			ordered = append(ordered, id)
		}
		sortStrings(ordered)

		orders := map[string]*orderLock{}
		for _, id := range ordered {
			var o orderLock
			err := tx.QueryRow(ctx, `
				SELECT id, user_id, side, type,
				       COALESCE(reserved_amount,0)::float8,
				       COALESCE(reserved_asset,''),
				       filled_quantity::float8, quantity::float8
				  FROM orders WHERE id = $1 FOR UPDATE`, id).
				Scan(&o.id, &o.userID, &o.side, &o.orderType, &o.reserved,
					&o.reservedAsset, &o.filled, &o.quantity)
			if err != nil {
				return fmt.Errorf("lock order %s: %w", id, err)
			}
			orders[id] = &o
		}

		// The fee schedule is per market; read it once.
		market, err := s.getMarketTx(ctx, tx, strings.ToUpper(fills[0].Symbol))
		if err != nil {
			return err
		}
		var makerFee, takerFee float64
		if err := tx.QueryRow(ctx, `
			SELECT maker_fee::float8, taker_fee::float8 FROM markets WHERE symbol = $1`,
			strings.ToUpper(fills[0].Symbol)).Scan(&makerFee, &takerFee); err != nil {
			return fmt.Errorf("read market fees: %w", err)
		}
		quoteAsset := market.QuoteAsset
		baseAsset := market.BaseAsset

		// Accumulate per-order fills and reservation consumption.
		filledDelta := map[string]float64{}
		reservedDelta := map[string]float64{}

		for _, f := range fills {
			taker := orders[f.TakerOrderID]
			maker := orders[f.MakerOrderID]
			if taker == nil || maker == nil {
				return ErrNotFound
			}
			takerSide := strings.ToLower(f.TakerSide)
			var buyer, seller *orderLock
			if takerSide == "buy" {
				buyer, seller = taker, maker
			} else {
				buyer, seller = maker, taker
			}

			notional := f.Price * f.Quantity
			// Fees are charged on the asset each side receives, at that side's
			// own rate (maker vs taker).
			buyerFeeRate := takerFee
			if buyer.id == maker.id {
				buyerFeeRate = makerFee
			}
			sellerFeeRate := takerFee
			if seller.id == maker.id {
				sellerFeeRate = makerFee
			}
			buyerFeeBase := f.Quantity * buyerFeeRate
			sellerFeeQuote := notional * sellerFeeRate
			if buyerFeeBase < 0 || sellerFeeQuote < 0 {
				return fmt.Errorf("negative fee for trade %s", f.TradeID)
			}

			// Buyer pays quote: consume the buy order's reservation, then any
			// shortfall (a market buy's slippage) from available funds.
			buyerReserved := orders[buyer.id].reserved
			if err := payOrderTx(ctx, tx, buyer.userID, quoteAsset, notional, buyerReserved, "trade_buy"); err != nil {
				return fmt.Errorf("settle buyer leg of %s: %w", f.TradeID, err)
			}
			reservedDelta[buyer.id] += notional

			// Seller pays base from its reservation.
			if err := payOrderTx(ctx, tx, seller.userID, baseAsset, f.Quantity, seller.reserved, "trade_sell"); err != nil {
				return fmt.Errorf("settle seller leg of %s: %w", f.TradeID, err)
			}
			reservedDelta[seller.id] += f.Quantity

			// Credits: buyer receives base less its fee; seller receives quote
			// less its fee. The withheld fees are booked to the venue.
			if err := creditAvailableTx(ctx, tx, buyer.userID, baseAsset, f.Quantity-buyerFeeBase, "trade_buy", "main"); err != nil {
				return err
			}
			if err := creditAvailableTx(ctx, tx, seller.userID, quoteAsset, notional-sellerFeeQuote, "trade_sell", "main"); err != nil {
				return err
			}
			if buyerFeeBase > 0 {
				if err := creditTreasuryTx(ctx, tx, baseAsset, buyerFeeBase, "trade_fee"); err != nil {
					return err
				}
			}
			if sellerFeeQuote > 0 {
				if err := creditTreasuryTx(ctx, tx, quoteAsset, sellerFeeQuote, "trade_fee"); err != nil {
					return err
				}
			}

			// Record the execution for both sides against their own order.
			if err := insertTradeTx(ctx, tx, buyer.id, f.Symbol, "buy", f.Price, f.Quantity,
				buyerFeeBase, baseAsset, buyer.id == maker.id); err != nil {
				return err
			}
			if err := insertTradeTx(ctx, tx, seller.id, f.Symbol, "sell", f.Price, f.Quantity,
				sellerFeeQuote, quoteAsset, seller.id == maker.id); err != nil {
				return err
			}

			filledDelta[buyer.id] += f.Quantity
			filledDelta[seller.id] += f.Quantity
		}

		// Apply per-order fills and reservations, then finalise each order.
		for id, o := range orders {
			newFilled := o.filled + filledDelta[id]
			newReserved := o.reserved - reservedDelta[id]
			if newReserved < 0 {
				newReserved = 0
			}
			terminal := newFilled >= o.quantity-1e-12
			if terminal {
				// Release whatever reservation remains.
				if newReserved > 0 {
					if err := unlockExactTx(ctx, tx, o.userID, o.reservedAsset, newReserved, "order_release"); err != nil {
						return err
					}
				}
				newReserved = 0
			}
			status := "new"
			switch {
			case terminal:
				status = "filled"
			case newFilled > 0:
				status = "partially_filled"
			}
			if _, err := tx.Exec(ctx, `
				UPDATE orders
				   SET filled_quantity = $2, reserved_amount = $3, status = $4::text,
				       completed_at = CASE WHEN $4::text = 'filled' THEN NOW() ELSE completed_at END,
				       updated_at = NOW()
				 WHERE id = $1`,
				id, decString(toDec(newFilled)), decString(toDec(newReserved)), status); err != nil {
				return fmt.Errorf("update order %s: %w", id, err)
			}
		}
		return nil
	})
}

// payOrderTx pays `amount` of `asset` for an order: it consumes up to `reserved`
// from the order's locked reservation and debits any remainder from the user's
// available balance (a market buy can fill above the price it reserved at). It
// fails closed when the total is not covered.
func payOrderTx(ctx context.Context, tx pgx.Tx, userID, asset string, amount, reserved float64, reference string) error {
	if amount <= 0 {
		return nil
	}
	fromLocked := amount
	if fromLocked > reserved {
		fromLocked = reserved
	}
	if fromLocked > 0 {
		if err := consumeLockedTx(ctx, tx, userID, asset, fromLocked, reference); err != nil {
			return err
		}
	}
	if short := amount - fromLocked; short > 0 {
		remaining, err := debitAvailableTx(ctx, tx, userID, asset, short)
		if err != nil {
			return err
		}
		if remaining > 0 {
			return ErrInsufficientFunds
		}
	}
	return nil
}

// creditAvailableTx adds funds to a user's available balance inside an existing
// transaction.
func creditAvailableTx(ctx context.Context, tx pgx.Tx, userID, asset string, amount float64, reference, network string) error {
	if amount <= 0 {
		return nil
	}
	network = networkOr(network)
	if err := ensureWalletLocked(ctx, tx, userID, asset, network); err != nil {
		return err
	}
	var available, locked float64
	if err := tx.QueryRow(ctx, `
		UPDATE wallets SET available = available + $4, updated_at = NOW()
		 WHERE user_id = $1 AND asset = $2 AND network = $3
		 RETURNING available::float8, locked::float8`,
		userID, asset, network, decString(toDec(amount))).Scan(&available, &locked); err != nil {
		return fmt.Errorf("credit available: %w", err)
	}
	return recordLedger(ctx, tx, userID, asset, network, "credit", amount, available, locked, reference)
}

// unlockExactTx returns exactly `amount` from locked to available across rows.
func unlockExactTx(ctx context.Context, tx pgx.Tx, userID, asset string, amount float64, reference string) error {
	if amount <= 0 {
		return nil
	}
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
	if err := rows.Err(); err != nil {
		return err
	}

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
		if err := tx.QueryRow(ctx, `
			UPDATE wallets SET locked = locked - $3, available = available + $3, updated_at = NOW()
			 WHERE user_id = $1 AND asset = $2 AND network = $4
			 RETURNING available::float8, locked::float8`,
			userID, asset, decString(toDec(take)), b.network).Scan(&available, &locked); err != nil {
			return err
		}
		if err := recordLedger(ctx, tx, userID, asset, b.network, "unlock", take, available, locked, reference); err != nil {
			return err
		}
		remaining -= take
	}
	if remaining > 0 {
		return ErrInsufficientFunds
	}
	return nil
}

// creditTreasuryTx adds to the venue's fee account inside a transaction.
func creditTreasuryTx(ctx context.Context, tx pgx.Tx, asset string, amount float64, reference string) error {
	if amount <= 0 {
		return nil
	}
	asset = strings.ToUpper(asset)
	var balance float64
	if err := tx.QueryRow(ctx, `
		INSERT INTO exchange_treasury (asset, network, balance)
		VALUES ($1, 'main', $2)
		ON CONFLICT (asset, network)
		DO UPDATE SET balance = exchange_treasury.balance + EXCLUDED.balance, updated_at = NOW()
		RETURNING balance::float8`, asset, decString(toDec(amount))).Scan(&balance); err != nil {
		return fmt.Errorf("credit treasury: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO exchange_treasury_entries (asset, network, kind, amount, balance_after, reference)
		VALUES ($1, 'main', 'fee', $2, $3, $4)`,
		asset, decString(toDec(amount)), decString(toDec(balance)), reference); err != nil {
		return fmt.Errorf("record treasury entry: %w", err)
	}
	return nil
}

// insertTradeTx records one side of an execution.
func insertTradeTx(ctx context.Context, tx pgx.Tx, orderID, symbol, side string, price, qty, fee float64, feeAsset string, maker bool) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO trades (order_id, market_id, symbol, side, price, quantity, fee, fee_asset, maker)
		VALUES ($1, (SELECT id FROM markets WHERE symbol = $2::text), $2, $3, $4, $5, $6, $7, $8)`,
		orderID, strings.ToUpper(symbol), side, decString(toDec(price)), decString(toDec(qty)),
		decString(toDec(fee)), feeAsset, maker)
	if err != nil {
		return fmt.Errorf("insert trade: %w", err)
	}
	return nil
}

// withRetry re-runs fn when it fails with a transient PostgreSQL error
// (serialization failure or deadlock).
func withRetry(ctx context.Context, attempts int, fn func() error) error {
	var err error
	for i := 0; i < attempts; i++ {
		if err = fn(); err == nil {
			return nil
		}
		if !isTransient(err) {
			return err
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
	}
	return err
}

// isTransient reports whether err is a retryable concurrency error.
func isTransient(err error) bool {
	var pgErr interface{ SQLState() string }
	if errors.As(err, &pgErr) {
		code := pgErr.SQLState()
		return code == "40001" || code == "40P01"
	}
	return false
}

// sortStrings is a tiny insertion sort so settlement does not pull in sort.
func sortStrings(a []string) {
	for i := 1; i < len(a); i++ {
		for j := i; j > 0 && a[j] < a[j-1]; j-- {
			a[j], a[j-1] = a[j-1], a[j]
		}
	}
}
