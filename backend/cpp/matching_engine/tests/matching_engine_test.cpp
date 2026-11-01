// Regression tests for the C++ matching engine core (matching_engine/src).
//
// These cover two defects that reached the engine as written:
//
//   1. OrderResult.avg_fill_price was assigned the order's limit price rather
//      than the volume-weighted mean of its fills, so a taker that swept
//      several price levels reported a price it never traded at.
//
//   2. StopLoss / TakeProfit / OCO / TrailingStop fell into switch branches
//      that set success = true and did nothing, so a caller was told a
//      conditional order was accepted and working when it had been dropped.
//
// Both are asserted against the real engine, not a stub.
#include "matching_engine.hpp"

#include <cassert>
#include <cstdio>
#include <string>

using namespace tigerex;

namespace {

constexpr const char* kSymbol = "BTC/USDT";
constexpr int kPricePrecision = 2;  // price values are integer cents
constexpr int kQtyPrecision = 3;    // quantity values are integer milli-units

const char* order_type_name(OrderType type) {
    switch (type) {
        case OrderType::Market: return "Market";
        case OrderType::Limit: return "Limit";
        case OrderType::StopLoss: return "StopLoss";
        case OrderType::StopLossLimit: return "StopLossLimit";
        case OrderType::TakeProfit: return "TakeProfit";
        case OrderType::TakeProfitLimit: return "TakeProfitLimit";
        case OrderType::OCO: return "OCO";
        case OrderType::TrailingStop: return "TrailingStop";
        case OrderType::FillOrKill: return "FillOrKill";
        case OrderType::ImmediateOrCancel: return "ImmediateOrCancel";
        case OrderType::GoodTillDate: return "GoodTillDate";
    }
    return "Unknown";
}

// Open one spot market on an already-constructed engine.
void setup_market(MatchingEngine& engine) {
    MarketInfo info;
    info.symbol = kSymbol;
    info.base_asset = "BTC";
    info.quote_asset = "USDT";
    info.market_type = MarketType::Spot;
    info.state = MarketState::Open;
    info.price_precision = kPricePrecision;
    info.quantity_precision = kQtyPrecision;
    info.min_price = int64_to_price(1, kPricePrecision);
    info.max_price = int64_to_price(INT64_MAX / 1000000, kPricePrecision);
    info.min_quantity = int64_to_quantity(1, kQtyPrecision);
    info.max_quantity = int64_to_quantity(INT64_MAX / 1000000, kQtyPrecision);
    info.tick_size = int64_to_price(1, kPricePrecision);
    info.lot_size = int64_to_quantity(1, kQtyPrecision);
    info.maker_fee_bps = 2;
    info.taker_fee_bps = 4;
    const bool created = engine.create_market(info);
    assert(created);
    (void)created;
}

Order make_order(uint64_t user_id, OrderSide side, OrderType type,
                 int64_t price, int64_t quantity) {
    Order order;
    order.user_id = user_id;
    order.symbol = kSymbol;
    order.side = side;
    order.type = type;
    order.market_type = MarketType::Spot;
    order.price = {price, kPricePrecision};
    order.quantity = {quantity, kQtyPrecision};
    order.remaining_quantity = {quantity, kQtyPrecision};
    order.status = OrderStatus::Open;
    return order;
}

// ---------------------------------------------------------------------------
// 1. A taker that sweeps two price levels must report the volume-weighted
//    average of what it actually filled at.
// ---------------------------------------------------------------------------
void test_avg_fill_price_is_volume_weighted() {
    MatchingEngine engine{EngineConfig{}};
    setup_market(engine);

    // Two resting asks: 1 unit @ 1000, 1 unit @ 1200.
    Order ask_a = make_order(1, OrderSide::Sell, OrderType::Limit, 1000, 1000);
    Order ask_b = make_order(2, OrderSide::Sell, OrderType::Limit, 1200, 1000);
    OrderResult ra = engine.submit_order(ask_a);
    OrderResult rb = engine.submit_order(ask_b);
    assert(ra.success);
    assert(rb.success);

    // Taker buys 2 units with a limit of 1300: it crosses both asks.
    Order taker = make_order(3, OrderSide::Buy, OrderType::Limit, 1300, 2000);
    OrderResult tr = engine.submit_order(taker);

    assert(tr.success);
    assert(tr.trades.size() == 2);
    assert(tr.filled_quantity[0] == 2000);

    // VWAP = (1*1000 + 1*1200) / 2 = 1100.
    const int64_t vwap = tr.avg_fill_price[0];
    assert(vwap == 1100);
    assert(tr.avg_fill_price[1] == kPricePrecision);

    // The old code returned the 1300 limit price here; guard against that.
    assert(tr.avg_fill_price[0] != 1300);

    std::printf("ok: avg_fill_price is volume-weighted (got %lld, expected 1100)\n",
                static_cast<long long>(vwap));
}

// ---------------------------------------------------------------------------
// 2. Conditional order types must fail closed, not silently succeed.
// ---------------------------------------------------------------------------
void test_conditional_orders_fail_closed() {
    const OrderType unsupported[] = {
        OrderType::StopLoss,
        OrderType::TakeProfit,
        OrderType::OCO,
        OrderType::TrailingStop,
    };

    for (OrderType type : unsupported) {
        MatchingEngine engine{EngineConfig{}};
    setup_market(engine);
        Order order = make_order(7, OrderSide::Buy, type, 1000, 1000);
        OrderResult result = engine.submit_order(order);

        // The defect: these returned success = true with no work done.
        assert(!result.success);
        assert(result.status == OrderStatus::Rejected);
        assert(!result.error_message.empty());
        assert(result.trades.empty());
        std::printf("ok: %s rejected (%s)\n",
                    order_type_name(type), result.error_message.c_str());
    }
}

// ---------------------------------------------------------------------------
// 3. A plain limit order that fills must report a positive fee for its own
//    user, and a non-crossing limit order must still rest.
// ---------------------------------------------------------------------------
void test_fee_and_resting_behaviour() {
    MatchingEngine engine{EngineConfig{}};
    setup_market(engine);

    Order maker = make_order(11, OrderSide::Sell, OrderType::Limit, 1000, 2000);
    assert(engine.submit_order(maker).success);

    Order taker = make_order(12, OrderSide::Buy, OrderType::Limit, 1000, 2000);
    OrderResult tr = engine.submit_order(taker);

    assert(tr.success);
    assert(tr.trades.size() == 1);
    assert(tr.filled_quantity[0] == 2000);

    // The taker filled at exactly one price, so its VWAP is that price.
    assert(tr.avg_fill_price[0] == 1000);

    // The fee must be the taker's own fee and therefore positive.
    assert(tr.fee[0] > 0);

    // Both sides are charged: the maker pays the maker fee, the taker pays the
    // taker fee. The single-slot Trade used to record only the maker's fee, so
    // the taker was never billed at all.
    assert(tr.trades.size() == 1);
    const Trade& t = tr.trades[0];
    assert(t.maker_fee[0] > 0);
    assert(t.taker_fee[0] > t.maker_fee[0]);  // taker rate (4bps) > maker (2bps)
    assert(t.maker_fee_user_id == 11);        // resting seller
    assert(t.taker_fee_user_id == 12);        // incoming buyer
    assert(t.maker_order_id == maker.id.server_order_id);
    assert(t.taker_order_id == taker.id.server_order_id);

    // The taker's own reported fee must be the taker fee, not the maker's.
    assert(tr.fee[0] == t.taker_fee[0]);

    // Both parties' positions must move, in opposite directions.
    assert(engine.get_position(11, kSymbol) == -2000);  // maker sold
    assert(engine.get_position(12, kSymbol) == 2000);   // taker bought

    // A non-crossing limit order must rest rather than fill.
    Order resting = make_order(13, OrderSide::Buy, OrderType::Limit, 900, 1000);
    OrderResult rr = engine.submit_order(resting);
    assert(rr.success);
    assert(rr.trades.empty());
    assert(rr.filled_quantity[0] == 0);

    std::printf("ok: fees attributed to the taker, non-crossing order rests\n");
}

}  // namespace

int main() {
    test_avg_fill_price_is_volume_weighted();
    test_conditional_orders_fail_closed();
    test_fee_and_resting_behaviour();
    std::printf("all matching-engine regression tests passed\n");
    return 0;
}
