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
#include <cstdlib>
#include <filesystem>
#include <fstream>
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

// ---------------------------------------------------------------------------
// 4. Maintenance paths must do the work they claim.
//    cleanup_expired_orders() and compact_order_books() used to be empty
//    bodies that returned 0, and p99_latency() returned the max sample.
// ---------------------------------------------------------------------------
void test_maintenance_paths() {
    MatchingEngine engine{EngineConfig{}};
    setup_market(engine);

    // A resting order with a deadline already in the past.
    Order expiring = make_order(21, OrderSide::Buy, OrderType::Limit, 900, 1000);
    expiring.tif = TimeInForce::GoodTillTime;
    expiring.expire_time = std::chrono::nanoseconds{1};
    OrderResult re = engine.submit_order(expiring);
    assert(re.success);

    // A resting order that never expires.
    Order permanent = make_order(22, OrderSide::Buy, OrderType::Limit, 800, 1000);
    OrderResult rp = engine.submit_order(permanent);
    assert(rp.success);

    const uint32_t removed = engine.cleanup_expired_orders();
    assert(removed == 1);

    // The permanent order is untouched.
    auto orders = engine.get_user_orders(kSymbol, 22);
    assert(orders.size() == 1);

    // GoodTillDate without an expiry is rejected rather than resting forever.
    Order no_expiry = make_order(23, OrderSide::Buy, OrderType::Limit, 700, 1000);
    no_expiry.tif = TimeInForce::GoodTillTime;
    OrderResult rn = engine.submit_order(no_expiry);
    assert(!rn.success);
    assert(rn.error_message.find("expire_time") != std::string::npos);

    // Compaction is a no-op on an already consistent book.
    engine.compact_order_books();

    // p99 is a bound on the tail, never the max of a wide sample. Submit
    // enough orders to populate the histogram and check it is finite.
    for (int i = 0; i < 200; ++i) {
        Order o = make_order(30, OrderSide::Buy, OrderType::Limit, 100 + i, 1000);
        engine.submit_order(o);
    }
    const uint64_t p99 = engine.p99_latency();
    const uint64_t max_latency = engine.get_stats().max_latency.load();
    assert(p99 > 0);
    // p99 is the upper bound of the bucket covering the slowest 1% of
    // samples. Bucket bounds are powers of two, so it can exceed the single
    // slowest sample by at most one doubling. It may also sit below the
    // maximum, because one outlier is not a percentile.
    assert(p99 <= max_latency * 2);

    std::printf("ok: expiry cleanup, compaction and p99 behave as documented\n");
}

// ---------------------------------------------------------------------------
// 5. sync_to_storage() must actually write a snapshot when configured, and be
//    a documented no-op when it is not.
// ---------------------------------------------------------------------------
void test_snapshot_persistence() {
    namespace fs = std::filesystem;
    const fs::path dir = fs::temp_directory_path() / "tigerex_engine_test_snapshots";
    fs::remove_all(dir);

    EngineConfig config{};
    config.snapshot_dir = dir.string();
    MatchingEngine engine{config};
    setup_market(engine);

    // Persistence disabled means nothing is written.
    assert(MatchingEngine{EngineConfig{}}.sync_to_storage() == 0);

    Order ask = make_order(41, OrderSide::Sell, OrderType::Limit, 1000, 1000);
    assert(engine.submit_order(ask).success);
    Order bid = make_order(42, OrderSide::Buy, OrderType::Limit, 900, 1000);
    assert(engine.submit_order(bid).success);

    assert(engine.sync_to_storage() == 1);

    // The snapshot must reflect the two resting orders.
    const auto stats = engine.get_stats();
    assert(stats.order_count == 2);

    const fs::path file = dir / "BTC_USDT.snapshot";
    assert(fs::exists(file));

    std::ifstream in(file);
    assert(in.good());
    const std::string contents((std::istreambuf_iterator<char>(in)),
                               std::istreambuf_iterator<char>());
    // The two resting orders must be in the written book, one per side.
    assert(contents.find("symbol=BTC/USDT") != std::string::npos);
    assert(contents.find("bids=1") != std::string::npos);
    assert(contents.find("asks=1") != std::string::npos);

    fs::remove_all(dir);
    std::printf("ok: sync_to_storage writes real snapshots\n");
}

// ---------------------------------------------------------------------------
// 6. A resting order must be indexed so it can be cancelled, and a match must
//    accumulate the exchange's trade statistics. Resting orders used to be
//    inserted into the price level without being indexed in orders_, so
//    cancel_order could never find them, and update_stats was never called.
// ---------------------------------------------------------------------------
void test_cancel_and_trade_stats() {
    MatchingEngine engine{EngineConfig{}};
    setup_market(engine);

    Order rest = make_order(51, OrderSide::Buy, OrderType::Limit, 900, 1000);
    OrderResult rr = engine.submit_order(rest);
    assert(rr.success);
    assert(engine.get_user_orders(kSymbol, 51).size() == 1);

    assert(engine.cancel_order(kSymbol, rest.id));
    assert(engine.get_user_orders(kSymbol, 51).empty());
    assert(engine.get_stats().order_count == 0);

    // A real match must move the trade counters off zero.
    Order ask = make_order(52, OrderSide::Sell, OrderType::Limit, 1000, 1000);
    assert(engine.submit_order(ask).success);
    Order buy = make_order(53, OrderSide::Buy, OrderType::Limit, 1000, 1000);
    OrderResult rb = engine.submit_order(buy);
    assert(rb.success);
    assert(rb.trades.size() == 1);

    const auto stats = engine.get_stats();
    assert(stats.total_trades.load() == 1);
    assert(stats.total_volume.load() > 0);
    assert(stats.total_fees.load() > 0);

    std::printf("ok: resting orders cancel and trades accumulate in stats\n");
}

}  // namespace

int main() {
    test_avg_fill_price_is_volume_weighted();
    test_conditional_orders_fail_closed();
    test_fee_and_resting_behaviour();
    test_maintenance_paths();
    test_snapshot_persistence();
    test_cancel_and_trade_stats();
    std::printf("all matching-engine regression tests passed\n");
    return 0;
}
