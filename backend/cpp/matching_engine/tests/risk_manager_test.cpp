// Tests for the risk manager: velocity limits, margin availability, and the
// order checks that guard funds.
//
// These assert the behaviour the old code got wrong:
//   - update_velocity() was an empty body, so orders_this_second/min/hour
//     never moved and the rate limit could never fire.
//   - The velocity counters had no time windows, so once they did move they
//     would only ever grow.
//   - check_margin_availability() compared the balance against
//     calculate_margin_requirement()'s -1 "invalid input" sentinel, which
//     passed every balance check instead of failing closed.
#include "matching_engine.hpp"
#include "risk_manager.hpp"

#include <cassert>
#include <cstdio>
#include <string>

using namespace tigerex;

namespace {

constexpr const char* kSymbol = "BTC/USDT";

void setup_market(MatchingEngine& engine) {
    MarketInfo info;
    info.symbol = kSymbol;
    info.base_asset = "BTC";
    info.quote_asset = "USDT";
    info.market_type = MarketType::Spot;
    info.state = MarketState::Open;
    info.price_precision = 2;
    info.quantity_precision = 3;
    info.min_price = int64_to_price(1, 2);
    info.max_price = int64_to_price(INT64_MAX / 1000000, 2);
    info.min_quantity = int64_to_quantity(1, 3);
    info.max_quantity = int64_to_quantity(INT64_MAX / 1000000, 3);
    info.tick_size = int64_to_price(1, 2);
    info.lot_size = int64_to_quantity(1, 3);
    assert(engine.create_market(info));
}

Order make_order(uint64_t user_id, OrderSide side, int64_t price, int64_t quantity) {
    Order order;
    order.user_id = user_id;
    order.symbol = kSymbol;
    order.side = side;
    order.type = OrderType::Limit;
    order.market_type = MarketType::Spot;
    order.price = {price, 2};
    order.quantity = {quantity, 3};
    order.remaining_quantity = {quantity, 3};
    order.status = OrderStatus::Open;
    return order;
}

// ---------------------------------------------------------------------------
// 1. Accepted orders must count against the user's velocity, and the limit
//    must eventually reject.
// ---------------------------------------------------------------------------
void test_velocity_limits_are_enforced() {
    RiskManager rm;
    rm.create_user_profile(1, 1);

    auto* profile = rm.get_profile(1);
    assert(profile != nullptr);
    // Small enough that the limit is reachable in a test.
    profile->limits.orders_per_second = 5;
    profile->limits.orders_per_minute = 1000000;
    profile->limits.orders_per_hour = 1000000;

    Order order = make_order(1, OrderSide::Buy, 100, 1000);

    for (uint32_t i = 0; i < 5; ++i) {
        RiskCheckResult r = rm.check_order_risk(order);
        assert(r.allowed);
    }
    // The counters must have actually moved.
    assert(profile->orders_this_second == 5);

    // The sixth order in the same second is over the limit.
    RiskCheckResult over = rm.check_order_risk(order);
    assert(!over.allowed);
    assert(over.reason == "Rate limit exceeded");

    // A rejected order must not consume budget.
    assert(profile->orders_this_second == 5);

    // After the window rolls over the user may trade again.
    profile->second_window_start = 1;  // far in the past
    RiskCheckResult after = rm.check_order_risk(order);
    assert(after.allowed);
    assert(profile->orders_this_second == 1);

    std::printf("ok: velocity limits are enforced and windows roll over\n");
}

// ---------------------------------------------------------------------------
// 2. An unknown user, a banned user and a trading-locked user are all rejected.
// ---------------------------------------------------------------------------
void test_restricted_users_are_rejected() {
    RiskManager rm;
    Order order = make_order(9, OrderSide::Buy, 100, 1000);

    // No profile at all: fail closed.
    RiskCheckResult none = rm.check_order_risk(order);
    assert(!none.allowed);
    assert(none.reason == "User profile not found");
    assert(rm.is_user_restricted(9));

    rm.create_user_profile(9, 1);
    assert(!rm.is_user_restricted(9));
    assert(rm.check_order_risk(order).allowed);

    rm.ban_user(9);
    RiskCheckResult banned = rm.check_order_risk(order);
    assert(!banned.allowed);
    assert(banned.reason == "Account suspended");

    RiskManager rm2;
    rm2.create_user_profile(10, 1);
    rm2.lock_user(10, true, true);
    Order locked_order = make_order(10, OrderSide::Buy, 100, 1000);
    RiskCheckResult locked = rm2.check_order_risk(locked_order);
    assert(!locked.allowed);
    assert(locked.reason == "Trading locked");

    std::printf("ok: unknown, banned and locked users are rejected\n");
}

// ---------------------------------------------------------------------------
// 3. Margin availability must fail closed on an invalid requirement.
// ---------------------------------------------------------------------------
void test_margin_fails_closed() {
    RiskManager rm;

    // calculate_margin_requirement() returns -1 for invalid input.
    Order bad = make_order(1, OrderSide::Buy, 0, 1000);
    assert(rm.calculate_margin_requirement(bad, 10) == -1);
    assert(rm.calculate_margin_requirement(bad, 0) == -1);
    assert(rm.calculate_margin_requirement(bad, 1000) == -1);

    // A -1 requirement must never be treated as satisfiable.
    assert(!rm.check_margin_availability(1, -1, 0));
    assert(!rm.check_margin_availability(1, -1, 1000000000));

    // A real requirement is compared against the balance.
    Order good = make_order(1, OrderSide::Buy, 100, 1000);
    const int64_t margin = rm.calculate_margin_requirement(good, 10);
    assert(margin > 0);
    assert(rm.check_margin_availability(1, margin, margin));
    assert(!rm.check_margin_availability(1, margin, margin - 1));

    // Margin call and liquidation thresholds fail closed on bad input.
    assert(rm.check_margin_call(0, 100));
    assert(rm.check_margin_call(100, -1));
    assert(rm.check_liquidation(0, 100));
    assert(rm.check_liquidation(100, -1));

    std::printf("ok: margin checks fail closed\n");
}

// ---------------------------------------------------------------------------
// 4. check_full_risk() must reject a user with no profile before touching the
//    book, and accept a healthy order.
// ---------------------------------------------------------------------------
void test_full_risk_path() {
    MatchingEngine engine{EngineConfig{}};
    setup_market(engine);

    OrderBook book(kSymbol, MarketType::Spot);
    RiskManager rm;

    Order order = make_order(5, OrderSide::Buy, 100, 1000);
    RiskCheckResult unknown = check_full_risk(rm, order, book, 1000000000, 0);
    assert(!unknown.allowed);

    rm.create_user_profile(5, 1);
    RiskCheckResult ok = check_full_risk(rm, order, book, 1000000000, 0);
    assert(ok.allowed);
    assert(ok.margin_required >= 0);

    std::printf("ok: full risk path rejects unknown users and accepts healthy orders\n");
}

// ---------------------------------------------------------------------------
// 5. The position limit must actually use the caller's position. The old code
//    passed a hardcoded zero, so a user already at their limit was never
//    stopped.
// ---------------------------------------------------------------------------
void test_full_risk_uses_the_caller_position() {
    MatchingEngine engine{EngineConfig{}};
    setup_market(engine);

    OrderBook book(kSymbol, MarketType::Spot);
    RiskManager rm;
    rm.create_user_profile(7, 1);

    auto* profile = rm.get_profile(7);
    assert(profile != nullptr);

    Order order = make_order(7, OrderSide::Buy, 100, 1000);
    // make_order stores price at scale 2 and quantity at scale 3, so the raw
    // product — which is what the risk path compares — is 100 * 1000 = 100000.
    // Set the limit just above it so only the position can push it over.
    const int64_t order_value = 100 * 1000;
    profile->limits.max_position = order_value + 5000;

    // Flat position: the order alone is inside the limit.
    assert(check_full_risk(rm, order, book, 1000000000000LL, 0).allowed);

    // An existing position that pushes the sum past the limit is rejected.
    RiskCheckResult over =
        check_full_risk(rm, order, book, 1000000000000LL, 10000);
    assert(!over.allowed);
    assert(over.reason == "Position limit exceeded");

    std::printf("ok: full risk path enforces the position limit\n");
}

// ---------------------------------------------------------------------------
// 6. A notional that overflows int64 must fail closed, not wrap into a value
//    that slips past every limit.
// ---------------------------------------------------------------------------
void test_full_risk_fails_closed_on_overflow() {
    MatchingEngine engine{EngineConfig{}};
    setup_market(engine);

    OrderBook book(kSymbol, MarketType::Spot);
    RiskManager rm;
    rm.create_user_profile(9, 1);

    Order order = make_order(9, OrderSide::Buy, INT64_MAX / 2, 1000);
    RiskCheckResult result = check_full_risk(rm, order, book, INT64_MAX, 0);
    assert(!result.allowed);
    assert(result.reason == "Order value overflow");

    std::printf("ok: full risk path fails closed on an overflowing notional\n");
}

}  // namespace

int main() {
    test_velocity_limits_are_enforced();
    test_restricted_users_are_rejected();
    test_margin_fails_closed();
    test_full_risk_path();
    test_full_risk_uses_the_caller_position();
    test_full_risk_fails_closed_on_overflow();
    std::printf("all risk manager tests passed\n");
    return 0;
}
