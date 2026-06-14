/**
 * TigerEx C++ Matching Engine
 * Market Management
 * Target Latency: < 50 microseconds
 */

#include "matching_engine.hpp"
#include <algorithm>

namespace tigerex {

// ============================================================================
// MARKET CREATION
// ============================================================================

bool create_spot_market(MatchingEngine& engine, const std::string& symbol,
                      const std::string& base, const std::string& quote,
                      int price_precision, int qty_precision) {
    MarketInfo info;
    info.symbol = symbol;
    info.base_asset = base;
    info.quote_asset = quote;
    info.market_type = MarketType::Spot;
    info.state = MarketState::Open;
    info.price_precision = price_precision;
    info.quantity_precision = qty_precision;
    info.min_price = int64_to_price(1, price_precision - 2);
    info.max_price = int64_to_price(INT64_MAX, price_precision);
    info.min_quantity = int64_to_quantity(1, qty_precision);
    info.max_quantity = int64_to_quantity(INT64_MAX, qty_precision);
    info.tick_size = int64_to_price(1, price_precision);
    info.lot_size = int64_to_quantity(1, qty_precision);
    info.allow_margin = false;
    info.max_leverage = 1;
    info.maker_fee_bps = 2;
    info.taker_fee_bps = 4;
    
    return engine.create_market(info);
}

bool create_margin_market(MatchingEngine& engine, const std::string& symbol,
                       const std::string& base, const std::string& quote,
                       int price_precision, int qty_precision, int max_leverage) {
    MarketInfo info;
    info.symbol = symbol;
    info.base_asset = base;
    info.quote_asset = quote;
    info.market_type = MarketType::Margin;
    info.state = MarketState::Open;
    info.price_precision = price_precision;
    info.quantity_precision = qty_precision;
    info.min_price = int64_to_price(1, price_precision - 2);
    info.max_price = int64_to_price(INT64_MAX, price_precision);
    info.min_quantity = int64_to_quantity(1, qty_precision);
    info.max_quantity = int64_to_quantity(INT64_MAX, qty_precision);
    info.tick_size = int64_to_price(1, price_precision);
    info.lot_size = int64_to_quantity(1, qty_precision);
    info.allow_margin = true;
    info.allow_short = true;
    info.max_leverage = max_leverage;
    info.maker_fee_bps = 2;
    info.taker_fee_bps = 4;
    
    return engine.create_market(info);
}

bool create_futures_market(MatchingEngine& engine, const std::string& symbol,
                         const std::string& base, const std::string& quote,
                         int price_precision, int qty_precision, 
                         int max_leverage, uint64_t delivery_time) {
    MarketInfo info;
    info.symbol = symbol;
    info.base_asset = base;
    info.quote_asset = quote;
    info.market_type = MarketType::Futures;
    info.state = MarketState::Open;
    info.price_precision = price_precision;
    info.quantity_precision = qty_precision;
    info.min_price = int64_to_price(1, price_precision - 2);
    info.max_price = int64_to_price(INT64_MAX, price_precision);
    info.min_quantity = int64_to_quantity(1, qty_precision);
    info.max_quantity = int64_to_quantity(INT64_MAX, qty_precision);
    info.tick_size = int64_to_price(1, price_precision);
    info.lot_size = int64_to_quantity(1, qty_precision);
    info.allow_margin = true;
    info.allow_short = true;
    info.max_leverage = max_leverage;
    info.maker_fee_bps = 2;
    info.taker_fee_bps = 4;
    
    return engine.create_market(info);
}

bool create_leveraged_token(MatchingEngine& engine, const std::string& symbol,
                         const std::string& underlying, int leverage) {
    MarketInfo info;
    info.symbol = symbol;
    info.base_asset = underlying + leverage + "L";
    info.quote_asset = "USDT";
    info.market_type = MarketType::LeveragedToken;
    info.state = MarketState::Open;
    info.price_precision = 8;
    info.quantity_precision = 2;
    info.min_price = int64_to_price(1, 6);
    info.max_price = int64_to_price(INT64_MAX, 6);
    info.min_quantity = int64_to_quantity(100, 2);
    info.max_quantity = int64_to_quantity(INT64_MAX, 2);
    info.tick_size = int64_to_price(1, 6);
    info.lot_size = int64_to_quantity(100, 2);
    info.allow_margin = false;
    info.max_leverage = leverage;
    info.maker_fee_bps = 2;
    info.taker_fee_bps = 4;
    
    return engine.create_market(info);
}

// ============================================================================
// DEFAULT MARKETS
// ============================================================================

void create_default_markets(MatchingEngine& engine) {
    // Spot markets
    create_spot_market(engine, "BTC/USDT", "BTC", "USDT", 8, 8);
    create_spot_market(engine, "ETH/USDT", "ETH", "USDT", 8, 8);
    create_spot_market(engine, "BNB/USDT", "BNB", "USDT", 8, 2);
    create_spot_market(engine, "SOL/USDT", "SOL", "USDT", 8, 2);
    create_spot_market(engine, "XRP/USDT", "XRP", "USDT", 8, 1);
    create_spot_market(engine, "ADA/USDT", "ADA", "USDT", 8, 1);
    create_spot_market(engine, "DOGE/USDT", "DOGE", "USDT", 8, 0);
    create_spot_market(engine, "DOT/USDT", "DOT", "USDT", 8, 2);
    create_spot_market(engine, "MATIC/USDT", "MATIC", "USDT", 8, 2);
    create_spot_market(engine, "LTC/USDT", "LTC", "USDT", 8, 8);
    
    // Margin markets (10x leverage)
    create_margin_market(engine, "BTC/USDT", "BTC", "USDT", 8, 8, 10);
    create_margin_market(engine, "ETH/USDT", "ETH", "USDT", 8, 8, 10);
    create_margin_market(engine, "BNB/USDT", "BNB", "USDT", 8, 2, 10);
    
    // Futures markets (100x leverage)
    create_futures_market(engine, "BTC-USDT-250612", "BTC", "USDT", 8, 8, 100, 1750195200000000000ULL);
    create_futures_market(engine, "ETH-USDT-250612", "ETH", "USDT", 8, 8, 100, 1750195200000000000ULL);
    
    // Leveraged tokens
    create_leveraged_token(engine, "BTC3L", "BTC", 3);
    create_leveraged_token(engine, "BTC3S", "BTC", 3);
    create_leveraged_token(engine, "ETH3L", "ETH", 3);
    create_leveraged_token(engine, "ETH3S", "ETH", 3);
}

// ============================================================================
// MARKET QUERY HELPERS
// ============================================================================

std::vector<MarketInfo> get_all_markets_info(const MatchingEngine& engine) {
    std::vector<std::string> symbols = engine.get_all_markets();
    std::vector<MarketInfo> result;
    result.reserve(symbols.size());
    
    for (const auto& symbol : symbols) {
        auto* info = engine.get_market(symbol);
        if (info) {
            result.push_back(*info);
        }
    }
    
    return result;
}

std::vector<MarketInfo> get_markets_by_type(const MatchingEngine& engine, 
                                          MarketType type) {
    auto all = get_all_markets_info(engine);
    std::vector<MarketInfo> result;
    
    for (const auto& market : all) {
        if (market.market_type == type) {
            result.push_back(market);
        }
    }
    
    return result;
}

std::vector<MarketInfo> get_open_markets(const MatchingEngine& engine) {
    auto all = get_all_markets_info(engine);
    std::vector<MarketInfo> result;
    
    for (const auto& market : all) {
        if (market.state == MarketState::Open) {
            result.push_back(market);
        }
    }
    
    return result;
}

// ============================================================================
// MARKET STATISTICS
// ============================================================================

struct MarketStatistics {
    std::string symbol;
    uint32_t order_count;
    uint64_t volume_24h;
    uint64_t trades_24h;
    Price last_price;
    Price high_24h;
    Price low_24h;
    Price change_24h;
    double change_percent_24h;
};

MarketStatistics get_market_statistics(MatchingEngine& engine, 
                                     const std::string& symbol) {
    MarketStatistics stats;
    stats.symbol = symbol;
    
    auto* book = engine.get_order_book(symbol);
    if (!book) return stats;
    
    auto ticker = engine.get_ticker(symbol);
    
    stats.order_count = book->order_count();
    stats.volume_24h = ticker.volume_24h[0];
    stats.trades_24h = ticker.trades_24h;
    stats.last_price = ticker.last_price;
    stats.high_24h = ticker.high_24h;
    stats.low_24h = ticker.low_24h;
    
    // Calculate change
    if (ticker.last_price[0] > 0 && ticker.high_24h[0] > 0) {
        stats.change_24h[0] = ticker.last_price[0] - ticker.high_24h[0];
        stats.change_percent_24h = static_cast<double>(stats.change_24h[0]) / ticker.high_24h[0] * 100;
    }
    
    return stats;
}

} // namespace tigerex