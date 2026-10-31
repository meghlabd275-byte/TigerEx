#include "stock_trading.hpp"
#include <cassert>
#include <iostream>

using namespace tigerex::stock;

int main() {
    StockTradingEngine engine;

    // No listings are seeded: an unknown symbol cannot be traded.
    assert(!engine.place_order("u1", "AAPL", StockOrderType::MARKET, StockOrderSide::BUY, 1.0).has_value());
    assert(engine.get_all_listings().empty());

    engine.register_listing("AAPL", "Apple Inc.", "NASDAQ", "Technology");

    // Registered but unpriced: a market order must be rejected, not filled at an
    // invented price.
    assert(!engine.place_order("u1", "AAPL", StockOrderType::MARKET, StockOrderSide::BUY, 1.0).has_value());

    // A bad feed is rejected.
    assert(!engine.update_price("AAPL", -1.0, 0, 0, 0, 0));
    assert(!engine.update_price("AAPL", 0.0, 0, 0, 0, 0));

    assert(engine.update_price("AAPL", 185.50, 2.50, 5.2e7, 198.23, 164.08));
    auto listing = engine.get_listing("AAPL");
    assert(listing.has_value() && listing->price == 185.50);

    auto order_id = engine.place_order("u1", "AAPL", StockOrderType::MARKET, StockOrderSide::BUY, 10.0);
    assert(order_id.has_value());
    auto order = engine.get_order(*order_id);
    assert(order.has_value() && order->status == StockOrderStatus::FILLED);
    assert(order->avg_fill_price == 185.50);

    auto positions = engine.get_positions("u1");
    assert(positions.size() == 1);
    assert(positions[0].quantity == 10.0);
    assert(positions[0].avg_cost == 185.50);
    assert(positions[0].market_value == 1855.0);

    // A limit order rests until the market reaches it.
    auto limit = engine.place_order("u1", "AAPL", StockOrderType::LIMIT, StockOrderSide::BUY, 5.0, 150.0);
    assert(limit.has_value());
    assert(!engine.fill_order(*limit, 180.0));
    assert(engine.get_order(*limit)->status == StockOrderStatus::PENDING);
    assert(engine.fill_order(*limit, 149.0));
    assert(engine.get_order(*limit)->status == StockOrderStatus::FILLED);
    positions = engine.get_positions("u1");
    assert(positions[0].quantity == 15.0);

    // Selling more than held is rejected.
    auto oversell = engine.place_order("u1", "AAPL", StockOrderType::LIMIT, StockOrderSide::SELL, 100.0, 200.0);
    assert(oversell.has_value());
    assert(!engine.fill_order(*oversell, 201.0));
    assert(engine.get_order(*oversell)->status == StockOrderStatus::REJECTED);

    // Cancelling a resting order works; cancelling twice does not.
    auto resting = engine.place_order("u1", "AAPL", StockOrderType::LIMIT, StockOrderSide::BUY, 1.0, 100.0);
    assert(engine.cancel_order(*resting));
    assert(!engine.cancel_order(*resting));

    // Selling part of the position realises PnL against the average cost.
    auto sell = engine.place_order("u1", "AAPL", StockOrderType::LIMIT, StockOrderSide::SELL, 5.0, 200.0);
    assert(engine.fill_order(*sell, 200.0));
    positions = engine.get_positions("u1");
    assert(positions[0].quantity == 10.0);
    assert(positions[0].realized_pnl > 0.0);

    // Deactivating a listing blocks new orders.
    engine.set_active("AAPL", false);
    assert(!engine.place_order("u1", "AAPL", StockOrderType::MARKET, StockOrderSide::BUY, 1.0).has_value());

    std::cout << "stock_trading ok\n";
    return 0;
}
