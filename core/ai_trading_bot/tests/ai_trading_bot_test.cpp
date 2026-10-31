#include "ai_trading_bot.hpp"
#include <cassert>
#include <iostream>

using namespace tigerex::aibot;

int main() {
    AITradingBot bot;

    // No history: no signal, no analysis.
    assert(!bot.generate_signal("BTC/USDT", 100.0).has_value());
    assert(!bot.analyze_market("BTC/USDT", 100.0).has_value());

    // Feed a real, monotonically rising series.
    for (int i = 0; i < 60; ++i) {
        bot.ingest_price("BTC/USDT", 100.0 + i);
    }

    auto sig = bot.generate_signal("BTC/USDT", 159.0);
    assert(sig.has_value());
    assert(sig->direction == "BUY");
    assert(sig->confidence > 0.5);
    assert(sig->target_price > 159.0);
    assert(sig->reason.find("Fast MA above") != std::string::npos);

    auto analysis = bot.analyze_market("BTC/USDT", 159.0);
    assert(analysis.has_value());
    assert(analysis->trend == "bullish");
    assert(analysis->rsi > 50.0);
    // Support/resistance come from observed extremes, not a random band.
    assert(analysis->support_level == 100.0);
    assert(analysis->resistance_level == 159.0);
    assert(analysis->sentiment_score == 1.0);

    // A falling series produces a SELL.
    AITradingBot falling;
    for (int i = 0; i < 60; ++i) {
        falling.ingest_price("ETH/USDT", 200.0 - i);
    }
    auto sell = falling.generate_signal("ETH/USDT", 141.0);
    assert(sell.has_value());
    assert(sell->direction == "SELL");
    auto bear = falling.analyze_market("ETH/USDT", 141.0);
    assert(bear->trend == "bearish");

    // Invalid prices are rejected at ingestion.
    bool threw = false;
    try { bot.ingest_price("BTC/USDT", -1.0); } catch (const std::invalid_argument&) { threw = true; }
    assert(threw);

    // Grid bot: crossing levels down buys, crossing up sells and books profit.
    AITradingBot grid;
    std::string gid = grid.create_bot("u1", "BTC/USDT", BotStrategy::GRID, 1000.0, 90.0, 110.0);
    grid.execute_grid_bot(gid, 100.0);
    auto s0 = grid.get_bot_state(gid);
    assert(s0->total_trades == 0.0);
    grid.execute_grid_bot(gid, 98.0);
    auto s1 = grid.get_bot_state(gid);
    assert(s1->total_trades == 1.0);
    assert(s1->current_position > 0.0);
    grid.execute_grid_bot(gid, 108.0);
    auto s2 = grid.get_bot_state(gid);
    assert(s2->total_profit > 0.0);
    assert(s2->current_position == 0.0);

    // A flat price produces no further trades.
    double trades_before = s2->total_trades;
    grid.execute_grid_bot(gid, 108.0);
    assert(grid.get_bot_state(gid)->total_trades == trades_before);

    // DCA bot: buy near the floor, take profit only above the entry.
    AITradingBot dca;
    std::string did = dca.create_bot("u2", "ETH/USDT", BotStrategy::DCA, 1000.0, 100.0, 200.0);
    dca.execute_dca_bot(did, 105.0);
    auto d1 = dca.get_bot_state(did);
    assert(d1->current_position > 0.0);
    double entry = d1->average_entry;
    // take_profit is unset, so a higher price inside the band buys again
    // rather than closing at break-even.
    dca.execute_dca_bot(did, entry * 1.001);
    auto d2 = dca.get_bot_state(did);
    assert(d2->current_position > d1->current_position);
    assert(d2->total_trades == 2.0);
    // Above the floor band no further buys happen.
    dca.execute_dca_bot(did, 150.0);
    auto d3 = dca.get_bot_state(did);
    assert(d3->total_trades == 2.0);
    assert(d3->unrealized_pnl > 0.0);

    std::cout << "ai_trading_bot ok\n";
    return 0;
}
