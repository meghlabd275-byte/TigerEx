// Regression tests for the header-only HFT engine.
//
// These cover behaviour that was previously wrong or fail-open: the risk
// engine skipped every limit for a user it had not seen, the book returned an
// arbitrary hash-map level as the "best" price, and a market order filled
// against nothing.

#include "hft_engine.hpp"

#include <cstdio>
#include <utility>
#include <vector>

using namespace tigerex::hft;

static int failures = 0;

#define CHECK(cond)                                                          \
    do {                                                                     \
        if (!(cond)) {                                                       \
            std::printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);      \
            ++failures;                                                      \
        }                                                                    \
    } while (0)

static void test_risk_limits_apply_to_unknown_users() {
    RiskEngine risk;

    // Unknown user, but the order is far over the size limit.
    CHECK(!risk.check_order_risk(1, 100, 2'000'000, OrderSide::Buy));

    // Non-positive price or quantity is refused outright.
    CHECK(!risk.check_order_risk(1, -5, 10, OrderSide::Buy));
    CHECK(!risk.check_order_risk(1, 100, 0, OrderSide::Buy));
    CHECK(!risk.check_order_risk(1, 100, -1, OrderSide::Buy));

    // A market order (no limit price) is sized, not priced.
    CHECK(risk.check_order_risk(1, 0, 10, OrderSide::Buy));
    CHECK(!risk.check_order_risk(1, 0, 2'000'000, OrderSide::Buy));

    // A sane order from an unknown user is allowed.
    CHECK(risk.check_order_risk(1, 100, 10, OrderSide::Buy));

    // Once blocked, the user is refused.
    risk.block_user(1, "test");
    CHECK(!risk.check_order_risk(1, 100, 10, OrderSide::Buy));
    risk.unblock_user(1);
    CHECK(risk.check_order_risk(1, 100, 10, OrderSide::Buy));
}

static void test_best_prices_are_the_extremes() {
    OrderBook book(1);

    Order bid_low;
    bid_low.order_id = 1;
    bid_low.side = OrderSide::Buy;
    bid_low.price = 100;
    bid_low.remaining_quantity = 5;
    CHECK(book.add_order(&bid_low));

    Order bid_high;
    bid_high.order_id = 2;
    bid_high.side = OrderSide::Buy;
    bid_high.price = 110;
    bid_high.remaining_quantity = 3;
    CHECK(book.add_order(&bid_high));

    Order ask_high;
    ask_high.order_id = 3;
    ask_high.side = OrderSide::Sell;
    ask_high.price = 130;
    ask_high.remaining_quantity = 4;
    CHECK(book.add_order(&ask_high));

    Order ask_low;
    ask_low.order_id = 4;
    ask_low.side = OrderSide::Sell;
    ask_low.price = 120;
    ask_low.remaining_quantity = 7;
    CHECK(book.add_order(&ask_low));

    auto best_bid = book.best_bid();
    CHECK(best_bid.has_value());
    CHECK(best_bid->first == 110);
    CHECK(best_bid->second == 3);

    auto best_ask = book.best_ask();
    CHECK(best_ask.has_value());
    CHECK(best_ask->first == 120);
    CHECK(best_ask->second == 7);

    // Depth is ordered best-first on both sides.
    std::vector<OrderBookLevel> bids, asks;
    book.get_depth(10, bids, asks);
    CHECK(bids.size() == 2);
    CHECK(asks.size() == 2);
    CHECK(bids[0].price == 110);
    CHECK(bids[1].price == 100);
    CHECK(asks[0].price == 120);
    CHECK(asks[1].price == 130);
}

static void test_take_consumes_best_levels_first() {
    OrderBook book(1);

    Order a;
    a.order_id = 1;
    a.side = OrderSide::Sell;
    a.price = 120;
    a.remaining_quantity = 2;
    book.add_order(&a);

    Order b;
    b.order_id = 2;
    b.side = OrderSide::Sell;
    b.price = 130;
    b.remaining_quantity = 5;
    book.add_order(&b);

    // A buy for 4 should sweep 2 @ 120 and 2 @ 130.
    auto fills = book.take(OrderSide::Buy, 4);
    CHECK(fills.size() == 2);
    CHECK(fills[0].price == 120);
    CHECK(fills[0].quantity == 2);
    CHECK(fills[1].price == 130);
    CHECK(fills[1].quantity == 2);

    auto best_ask = book.best_ask();
    CHECK(best_ask.has_value());
    CHECK(best_ask->first == 130);
    CHECK(best_ask->second == 3);

    // Taking more than the book holds fills what is there and stops.
    auto rest = book.take(OrderSide::Buy, 100);
    CHECK(rest.size() == 1);
    CHECK(rest[0].quantity == 3);
    CHECK(!book.best_ask().has_value());
}

static void test_market_order_without_liquidity_is_rejected() {
    HFTEngine engine;
    CHECK(engine.start());

    // No book liquidity on the sell side yet.
    auto result = engine.submit_order(1, "BTCUSDT", OrderSide::Buy,
                                      OrderType::Market, 1);
    CHECK(!result.has_value());

    auto metrics = engine.get_metrics();
    CHECK(metrics.total_trades == 0);

    engine.stop();
}

static void test_market_order_fills_against_resting_limit() {
    HFTEngine engine;
    CHECK(engine.start());

    // Rest a sell limit order, then take it with a market buy.
    auto maker = engine.submit_order(1, "BTCUSDT", OrderSide::Sell,
                                     OrderType::Limit, 5, 100);
    CHECK(maker.has_value());

    auto taker = engine.submit_order(2, "BTCUSDT", OrderSide::Buy,
                                     OrderType::Market, 3);
    CHECK(taker.has_value());

    auto metrics = engine.get_metrics();
    CHECK(metrics.total_trades == 1);

    auto maker_order = engine.get_order(*maker);
    CHECK(maker_order.has_value());
    CHECK(maker_order->filled_quantity == 3);
    CHECK(maker_order->remaining_quantity == 2);

    auto taker_order = engine.get_order(*taker);
    CHECK(taker_order.has_value());
    CHECK(taker_order->status == OrderStatus::Filled);

    engine.stop();
}

static void test_unknown_symbol_is_refused() {
    HFTEngine engine;
    CHECK(engine.start());

    auto result = engine.submit_order(1, "NOTAPAIR", OrderSide::Buy,
                                      OrderType::Limit, 1, 100);
    CHECK(!result.has_value());

    engine.stop();
}

int main() {
    test_risk_limits_apply_to_unknown_users();
    test_best_prices_are_the_extremes();
    test_take_consumes_best_levels_first();
    test_market_order_without_liquidity_is_rejected();
    test_market_order_fills_against_resting_limit();
    test_unknown_symbol_is_refused();

    if (failures == 0) {
        std::printf("hft_engine_test: all checks passed\n");
        return 0;
    }
    std::printf("hft_engine_test: %d check(s) failed\n", failures);
    return 1;
}
