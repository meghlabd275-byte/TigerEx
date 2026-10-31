// Regression tests for the low-latency matching engine.
//
// These pin down the behaviour the previous engine got wrong or never
// implemented: it matched nothing, reported every cancel as successful, and
// used floating-point prices. Each case below fails against that engine.
#include "hft_low_latency.hpp"

#include <cstdio>
#include <string>

using namespace tigerex::hft;

static int failures = 0;

#define CHECK(cond)                                                        \
    do {                                                                   \
        if (!(cond)) {                                                     \
            std::printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);    \
            ++failures;                                                    \
        }                                                                  \
    } while (0)

static Order limit(OrderId id, UserId user, Side side, Price price, Quantity qty,
                   TimeInForce tif = TimeInForce::GTC) {
    Order o{};
    o.id = id;
    o.user = user;
    o.side = side;
    o.type = OrderType::Limit;
    o.tif = tif;
    o.price = price;
    o.quantity = qty;
    return o;
}

static Order market(OrderId id, UserId user, Side side, Quantity qty,
                    TimeInForce tif = TimeInForce::IOC) {
    Order o{};
    o.id = id;
    o.user = user;
    o.side = side;
    o.type = OrderType::Market;
    o.tif = tif;
    o.quantity = qty;
    return o;
}

// 1. A non-crossing limit order rests and becomes the best bid/ask.
static void resting_orders_do_not_cross() {
    OrderBook book("BTC/RUSD");
    CHECK(book.submit(limit(1, 1, Side::Buy, 50000, 100)).status == Status::New);
    CHECK(book.submit(limit(2, 2, Side::Sell, 51000, 50)).status == Status::New);
    CHECK(book.best_bid() == 50000);
    CHECK(book.best_ask() == 51000);
    CHECK(book.resting_orders() == 2);
}

// 2. A crossing taker fills against the resting maker and the trade records
//    both parties at the maker's price.
static void crossing_order_fills_and_publishes_trade() {
    OrderBook book("BTC/RUSD");
    book.submit(limit(1, 10, Side::Sell, 50000, 10));

    Order taker = limit(2, 20, Side::Buy, 50000, 10);
    SubmitResult r = book.submit(taker);
    CHECK(r.status == Status::Filled);
    CHECK(r.filled == 10);
    CHECK(r.trades.size() == 1);
    CHECK(r.trades[0].taker == 2);
    CHECK(r.trades[0].maker == 1);
    CHECK(r.trades[0].taker_user == 20);
    CHECK(r.trades[0].maker_user == 10);
    CHECK(r.trades[0].price == 50000);
    CHECK(r.trades[0].quantity == 10);
    // Both sides must be gone: a later order must not match anything.
    CHECK(book.resting_orders() == 0);
    CHECK(!book.best_bid().has_value());
    CHECK(!book.best_ask().has_value());
    CHECK(book.submit(limit(3, 30, Side::Buy, 50000, 5)).trades.empty());
}

// 3. Price priority: the taker takes the best ask first, not the oldest.
static void best_price_is_taken_first() {
    OrderBook book("BTC/RUSD");
    book.submit(limit(1, 1, Side::Sell, 50000, 5));  // worse price, older
    book.submit(limit(2, 2, Side::Sell, 49000, 5));  // better price, newer

    SubmitResult r = book.submit(limit(3, 3, Side::Buy, 50000, 5));
    CHECK(r.trades.size() == 1);
    CHECK(r.trades[0].maker == 2);
    CHECK(r.trades[0].price == 49000);
}

// 4. Time priority at the same price: the first resting order fills first.
static void time_priority_at_same_price() {
    OrderBook book("BTC/RUSD");
    book.submit(limit(1, 1, Side::Sell, 50000, 5));
    book.submit(limit(2, 2, Side::Sell, 50000, 5));

    SubmitResult r = book.submit(limit(3, 3, Side::Buy, 50000, 5));
    CHECK(r.trades.size() == 1);
    CHECK(r.trades[0].maker == 1);
    CHECK(book.ask_quantity_at(50000) == 5);  // the second order still rests
}

// 5. Partial fill: the taker takes what is there, the remainder rests, and the
//    maker level keeps the correct remaining quantity.
static void partial_fill_keeps_correct_remainder() {
    OrderBook book("BTC/RUSD");
    book.submit(limit(1, 1, Side::Sell, 50000, 4));

    SubmitResult r = book.submit(limit(2, 2, Side::Buy, 50000, 10));
    CHECK(r.status == Status::PartiallyFilled);
    CHECK(r.filled == 4);
    CHECK(book.bid_quantity_at(50000) == 6);
    CHECK(book.resting_orders() == 1);
    CHECK(book.best_bid() == 50000);
}

// 6. Cancel must actually remove the order; cancelling an unknown id must fail.
static void cancel_removes_order_and_reports_unknown() {
    OrderBook book("BTC/RUSD");
    book.submit(limit(1, 1, Side::Buy, 49000, 10));
    CHECK(book.cancel(1));
    CHECK(!book.best_bid().has_value());
    CHECK(book.resting_orders() == 0);
    CHECK(!book.cancel(1));       // already gone
    CHECK(!book.cancel(999999));  // never existed
}

// 7. IOC: whatever cannot be filled immediately is cancelled, never rested.
static void ioc_never_rests() {
    OrderBook book("BTC/RUSD");
    book.submit(limit(1, 1, Side::Sell, 50000, 3));

    SubmitResult r = book.submit(limit(2, 2, Side::Buy, 50000, 10, TimeInForce::IOC));
    CHECK(r.status == Status::PartiallyFilled);
    CHECK(r.filled == 3);
    CHECK(!book.best_bid().has_value());
    CHECK(book.resting_orders() == 0);
}

// 8. FOK: rejected whole when the book is short, filled whole when it is not.
static void fok_is_all_or_nothing() {
    OrderBook book("BTC/RUSD");
    book.submit(limit(1, 1, Side::Sell, 50000, 3));

    SubmitResult rejected =
        book.submit(limit(2, 2, Side::Buy, 50000, 10, TimeInForce::FOK));
    CHECK(rejected.status == Status::Rejected);
    CHECK(rejected.trades.empty());
    CHECK(book.ask_quantity_at(50000) == 3);  // book untouched

    SubmitResult filled = book.submit(limit(3, 3, Side::Buy, 50000, 3, TimeInForce::FOK));
    CHECK(filled.status == Status::Filled);
    CHECK(filled.filled == 3);
}

// 9. Market orders sweep levels and never rest.
static void market_order_sweeps_and_never_rests() {
    OrderBook book("BTC/RUSD");
    book.submit(limit(1, 1, Side::Sell, 50000, 2));
    book.submit(limit(2, 2, Side::Sell, 50100, 2));

    SubmitResult r = book.submit(market(3, 3, Side::Buy, 5));
    CHECK(r.filled == 4);
    CHECK(r.trades.size() == 2);
    CHECK(r.status == Status::PartiallyFilled);
    CHECK(!book.best_bid().has_value());
    CHECK(!book.best_ask().has_value());
}

// 10. Invalid input is rejected, not accepted: zero/negative size, and a limit
//     order without a positive price.
static void invalid_orders_are_rejected() {
    OrderBook book("BTC/RUSD");
    CHECK(book.submit(limit(1, 1, Side::Buy, 50000, 0)).status == Status::Rejected);
    CHECK(book.submit(limit(2, 1, Side::Buy, 50000, -5)).status == Status::Rejected);
    CHECK(book.submit(limit(3, 1, Side::Buy, 0, 10)).status == Status::Rejected);
    CHECK(book.submit(limit(4, 1, Side::Buy, -1, 10)).status == Status::Rejected);
    CHECK(book.resting_orders() == 0);
}

// 11. A market order with GTC is coerced to IOC rather than resting unpriced.
static void market_gtc_is_coerced_to_ioc() {
    OrderBook book("BTC/RUSD");
    SubmitResult r = book.submit(market(1, 1, Side::Buy, 10, TimeInForce::GTC));
    CHECK(r.status == Status::Cancelled);
    CHECK(book.resting_orders() == 0);
}

// 12. The price-level cap is a hard bound: an over-cap book rejects the rest.
static void price_level_cap_is_enforced() {
    OrderBook book("BTC/RUSD", 2);
    CHECK(book.submit(limit(1, 1, Side::Buy, 100, 1)).status == Status::New);
    CHECK(book.submit(limit(2, 1, Side::Buy, 99, 1)).status == Status::New);
    CHECK(book.submit(limit(3, 1, Side::Buy, 98, 1)).status == Status::Rejected);
    CHECK(book.resting_orders() == 2);
    // Filling at an existing level must still work at the cap.
    CHECK(book.submit(limit(4, 2, Side::Sell, 100, 1)).status == Status::Filled);
}

// 13. Depth is returned best-first with correct aggregated quantities.
static void depth_is_best_first_and_aggregated() {
    OrderBook book("BTC/RUSD");
    book.submit(limit(1, 1, Side::Buy, 50000, 3));
    book.submit(limit(2, 1, Side::Buy, 50000, 2));
    book.submit(limit(3, 1, Side::Buy, 49900, 7));
    book.submit(limit(4, 1, Side::Sell, 50100, 4));

    auto [bids, asks] = book.depth(5);
    CHECK(bids.size() == 2);
    CHECK(bids[0].first == 50000 && bids[0].second == 5);
    CHECK(bids[1].first == 49900 && bids[1].second == 7);
    CHECK(asks.size() == 1);
    CHECK(asks[0].first == 50100 && asks[0].second == 4);
}

// 14. The engine routes symbols to separate books and keeps real counters.
static void engine_routes_symbols_and_counts() {
    MatchingEngine engine;
    engine.submit("BTC/RUSD", limit(1, 1, Side::Sell, 50000, 5));
    engine.submit("ETH/RUSD", limit(2, 2, Side::Sell, 3000, 5));

    SubmitResult r = engine.submit("BTC/RUSD", limit(3, 3, Side::Buy, 50000, 5));
    CHECK(r.status == Status::Filled);
    CHECK(engine.trades() == 1);
    CHECK(engine.volume() == 5);
    CHECK(engine.orders() == 3);
    // The ETH book must be untouched by the BTC trade.
    CHECK(engine.book("ETH/RUSD").resting_orders() == 1);
    CHECK(engine.cancel("ETH/RUSD", 2));
    CHECK(engine.cancelled() == 1);
    CHECK(!engine.cancel("ETH/RUSD", 2));
}

int main() {
    resting_orders_do_not_cross();
    crossing_order_fills_and_publishes_trade();
    best_price_is_taken_first();
    time_priority_at_same_price();
    partial_fill_keeps_correct_remainder();
    cancel_removes_order_and_reports_unknown();
    ioc_never_rests();
    fok_is_all_or_nothing();
    market_order_sweeps_and_never_rests();
    invalid_orders_are_rejected();
    market_gtc_is_coerced_to_ioc();
    price_level_cap_is_enforced();
    depth_is_best_first_and_aggregated();
    engine_routes_symbols_and_counts();

    if (failures == 0) {
        std::printf("hft_low_latency_test: all checks passed\n");
        return 0;
    }
    std::printf("hft_low_latency_test: %d check(s) failed\n", failures);
    return 1;
}
