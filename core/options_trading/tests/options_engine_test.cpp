#include "options_engine.hpp"

#include <cassert>
#include <cmath>
#include <iostream>

using namespace tigerex::options;

namespace {

bool close(double a, double b, double tol) { return std::abs(a - b) < tol; }

OptionContract make_contract(const std::string& symbol, OptionType type, uint64_t strike) {
    OptionContract c;
    c.symbol = symbol;
    c.underlying_symbol = "BTC";
    c.type = type;
    c.style = OptionStyle::EUROPEAN;
    c.category = OptionCategory::VANILLA;
    c.strike_price = strike * 100000000ULL;
    c.expiry_time = 0;
    c.contract_size = 1;
    c.min_tick = 1;
    c.max_order_value = 0;
    c.maker_fee = 0;
    c.taker_fee = 0;
    c.is_active = true;
    c.is_settled = false;
    c.settlement_price = 0;
    c.exercise_method = ExerciseMethod::CASH;
    c.is_auto_exercisable = true;
    c.auto_exercise_threshold = 0.01;
    return c;
}

// Black-Scholes satisfies put-call parity exactly; this catches sign and
// discount-factor errors in either price.
void test_put_call_parity() {
    const double S = 50000.0, K = 50000.0, T = 0.5, r = 0.05, q = 0.0, sigma = 0.5;
    double call = BlackScholesModel::calculate_call_price(S, K, T, r, q, sigma);
    double put = BlackScholesModel::calculate_put_price(S, K, T, r, q, sigma);

    assert(call > 0.0 && put > 0.0);
    double parity = call - put - S * std::exp(-q * T) + K * std::exp(-r * T);
    assert(close(parity, 0.0, 1e-6));

    // A deep in-the-money call is worth at least its discounted intrinsic.
    double itm = BlackScholesModel::calculate_call_price(60000.0, 50000.0, 0.25, r, q, sigma);
    assert(itm >= 10000.0 * std::exp(-r * 0.25) - 1e-6);
}

// A degenerate spot or strike must not produce NaN.
void test_degenerate_inputs() {
    double call = BlackScholesModel::calculate_call_price(0.0, 100.0, 1.0, 0.05, 0.0, 0.2);
    double put = BlackScholesModel::calculate_put_price(100.0, 0.0, 1.0, 0.05, 0.0, 0.2);
    assert(std::isfinite(call));
    assert(std::isfinite(put));
    assert(close(call, 0.0, 1e-9));
}

// The binomial lattice must agree with Black-Scholes for European options and
// price an American put at or above its European counterpart.
void test_binomial_model() {
    const double S = 50000.0, K = 50000.0, T = 0.5, r = 0.05, q = 0.0, sigma = 0.5;

    double european_binomial = BinomialModel::calculate_option_price(
        S, K, T, r, q, sigma, OptionType::CALL, OptionStyle::EUROPEAN, 500);
    double black_scholes = BlackScholesModel::calculate_call_price(S, K, T, r, q, sigma);
    assert(close(european_binomial, black_scholes, 5.0));

    double american_put = BinomialModel::calculate_option_price(
        S, K, T, r, q, sigma, OptionType::PUT, OptionStyle::AMERICAN, 500);
    double european_put = BinomialModel::calculate_option_price(
        S, K, T, r, q, sigma, OptionType::PUT, OptionStyle::EUROPEAN, 500);
    assert(american_put >= european_put - 1e-6);

    // An American put on a non-dividend payer with rates above zero must be
    // strictly worth more than the European put once early exercise matters.
    assert(american_put > european_put);
}

void test_monte_carlo() {
    const double S = 50000.0, K = 50000.0, T = 0.5, r = 0.05, q = 0.0, sigma = 0.5;
    double mc = MonteCarloEngine::calculate_option_price(
        S, K, T, r, q, sigma, OptionType::CALL, 200000);
    double bs = BlackScholesModel::calculate_call_price(S, K, T, r, q, sigma);
    assert(close(mc, bs, 200.0));
}

void test_implied_volatility_round_trip() {
    const double S = 50000.0, K = 50000.0, T = 0.5, r = 0.05, q = 0.0, sigma = 0.5;
    double price = BlackScholesModel::calculate_call_price(S, K, T, r, q, sigma);

    auto solved = ImpliedVolatilitySolver::calculate_implied_volatility(
        price, S, K, T, r, q, OptionType::CALL, 0.3);
    assert(solved.has_value());
    assert(close(*solved, sigma, 1e-4));

    // A price below intrinsic is not reachable by any volatility.
    assert(!ImpliedVolatilitySolver::calculate_implied_volatility(
        1.0, 60000.0, 50000.0, 0.5, r, q, OptionType::CALL).has_value());
}

void test_position_exercise_pnl() {
    PositionManager manager;

    OptionPosition long_call;
    long_call.position_id = 1;
    long_call.user_id = 7;
    long_call.symbol = "BTC-C-50000";
    long_call.side = PositionSide::LONG;
    long_call.type = OptionType::CALL;
    long_call.strike_price = 50000ULL * 100000000ULL;
    long_call.quantity = 1;
    long_call.filled_quantity = 1;
    long_call.average_price = 2000ULL * 100000000ULL;  // premium paid
    manager.open_position(long_call);

    // Settles at 55000: intrinsic 5000, premium 2000, so +3000.
    assert(manager.exercise_position(1, 55000ULL * 100000000ULL));
    auto pos = manager.get_position(1);
    assert(pos.has_value());
    assert(pos->realized_pnl == 3000LL * 100000000LL);

    // A second exercise of the same position is refused.
    assert(!manager.exercise_position(1, 55000ULL * 100000000ULL));

    // A short call owes the intrinsic less the premium received.
    OptionPosition short_call;
    short_call.position_id = 2;
    short_call.user_id = 8;
    short_call.symbol = "BTC-C-50000";
    short_call.side = PositionSide::SHORT;
    short_call.type = OptionType::CALL;
    short_call.strike_price = 50000ULL * 100000000ULL;
    short_call.quantity = 1;
    short_call.filled_quantity = 1;
    short_call.average_price = 2000ULL * 100000000ULL;
    manager.open_position(short_call);

    assert(manager.exercise_position(2, 55000ULL * 100000000ULL));
    pos = manager.get_position(2);
    assert(pos->realized_pnl == -3000LL * 100000000LL);

    // An out-of-the-money long call expires worthless: a full loss of premium.
    OptionPosition otm;
    otm.position_id = 3;
    otm.user_id = 9;
    otm.symbol = "BTC-C-60000";
    otm.side = PositionSide::LONG;
    otm.type = OptionType::CALL;
    otm.strike_price = 60000ULL * 100000000ULL;
    otm.quantity = 1;
    otm.filled_quantity = 1;
    otm.average_price = 500ULL * 100000000ULL;
    manager.open_position(otm);

    assert(manager.exercise_position(3, 55000ULL * 100000000ULL));
    pos = manager.get_position(3);
    assert(pos->realized_pnl == -500LL * 100000000LL);
}

void test_volatility_surface() {
    VolatilitySurfaceManager manager;

    // No surface means no volatility, never a default.
    assert(!manager.get_volatility("BTC", 50000.0, 0.5).has_value());

    VolatilitySmile smile;
    smile.underlying_symbol = "BTC";
    smile.base_volatility = 0.5;
    smile.skew = 0.0;
    smile.points = {
        {40000.0, 0.5, 0.55},
        {60000.0, 0.5, 0.45},
    };
    manager.update_surface("BTC", smile);

    auto mid = manager.get_volatility("BTC", 50000.0, 0.5);
    assert(mid.has_value());
    assert(close(*mid, 0.50, 1e-9));

    // Outside the observed strikes, the nearest point is used.
    auto low = manager.get_volatility("BTC", 10000.0, 0.5);
    assert(low.has_value() && close(*low, 0.55, 1e-9));
}

void test_engine_prices_only_with_surface() {
    OptionTradingEngine engine;
    assert(engine.initialize_contract(make_contract("BTC-C-50000", OptionType::CALL, 50000)));

    // Without an observed surface the engine reports no price.
    assert(close(engine.calculate_price("BTC-C-50000", 52000.0, 0.1), 0.0, 1e-12));

    VolatilitySmile smile;
    smile.underlying_symbol = "BTC-C-50000";
    smile.base_volatility = 0.5;
    smile.skew = 0.0;
    smile.points = {
        {50000.0, 0.1, 0.5},
    };
    engine.update_volatility_surface("BTC-C-50000", smile);

    double priced = engine.calculate_price("BTC-C-50000", 52000.0, 0.1);
    assert(priced > 0.0);
    assert(close(priced, BlackScholesModel::calculate_call_price(52000.0, 50000.0, 0.1, 0.05, 0.0, 0.5), 1e-6));

    // Greeks come back non-zero once a surface exists.
    Greeks greeks = engine.calculate_greeks("BTC-C-50000", 52000.0, 0.1);
    assert(greeks.delta > 0.0);

    // An unknown contract still reports nothing.
    assert(!engine.get_contract("UNKNOWN").has_value());
    assert(close(engine.calculate_price("UNKNOWN", 52000.0, 0.1), 0.0, 1e-12));
}

}  // namespace

int main() {
    test_put_call_parity();
    test_degenerate_inputs();
    test_binomial_model();
    test_monte_carlo();
    test_implied_volatility_round_trip();
    test_position_exercise_pnl();
    test_volatility_surface();
    test_engine_prices_only_with_surface();

    std::cout << "options_engine ok\n";
    return 0;
}
