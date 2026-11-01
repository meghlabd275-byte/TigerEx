#pragma once

// Market construction and query helpers. These build the MarketInfo records
// that MatchingEngine::create_market() validates, and read back aggregate
// statistics. They live in src/market.cpp; nothing could call them before
// because no header declared them.
#include "matching_engine.hpp"

#include <string>
#include <vector>

namespace tigerex {

/// Create a spot market and open its book.
bool create_spot_market(MatchingEngine& engine, const std::string& symbol,
                        const std::string& base, const std::string& quote,
                        int price_precision, int qty_precision);

/// Create a margin market with the given maximum leverage.
bool create_margin_market(MatchingEngine& engine, const std::string& symbol,
                          const std::string& base, const std::string& quote,
                          int price_precision, int qty_precision, int max_leverage);

/// Create a dated futures market. delivery_time is nanoseconds since the
/// epoch; the market stops accepting orders once it is reached.
bool create_futures_market(MatchingEngine& engine, const std::string& symbol,
                           const std::string& base, const std::string& quote,
                           int price_precision, int qty_precision,
                           int max_leverage, uint64_t delivery_time);

/// Create a leveraged token market (for example BTC3L) for an underlying.
bool create_leveraged_token(MatchingEngine& engine, const std::string& symbol,
                            const std::string& underlying, int leverage);

/// Register the markets TigerEx ships with.
void create_default_markets(MatchingEngine& engine);

/// All markets, as full MarketInfo records.
std::vector<MarketInfo> get_all_markets_info(const MatchingEngine& engine);

/// Markets of one type.
std::vector<MarketInfo> get_markets_by_type(const MatchingEngine& engine,
                                            MarketType type);

/// Markets currently open for trading.
std::vector<MarketInfo> get_open_markets(const MatchingEngine& engine);

struct MarketStatistics {
    std::string symbol;
    uint32_t order_count{0};
    uint64_t volume_24h{0};
    uint64_t trades_24h{0};
    Price last_price;
    Price high_24h;
    Price low_24h;
    Price change_24h;
    double change_percent_24h{0.0};
};

/// Aggregate statistics for one market. An unknown symbol yields a zeroed
/// record rather than throwing.
MarketStatistics get_market_statistics(MatchingEngine& engine,
                                       const std::string& symbol);

}  // namespace tigerex
