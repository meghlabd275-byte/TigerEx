/**
 * TigerEx C++ Matching Engine
 * Order Implementation
 * Target Latency: < 50 microseconds
 */

#include "order.hpp"
#include <sstream>
#include <iomanip>

namespace tigerex {

// ============================================================================
// ORDER ID GENERATION
// ============================================================================

OrderId create_order_id(uint64_t client_order_id, uint64_t server_order_id) {
    OrderId id;
    id.client_order_id = client_order_id;
    id.server_order_id = server_order_id;
    id.timestamp_ns = std::chrono::duration_cast<std::chrono::nanoseconds>(
        std::chrono::steady_clock::now().time_since_epoch()
    ).count();
    id.sequence = 0;
    return id;
}

// ============================================================================
// ORDER VALIDATION
// ============================================================================

bool validate_order(const Order& order) {
    // Check required fields
    if (order.symbol.empty()) return false;
    if (order.quantity[0] <= 0) return false;
    
    // Price validation based on order type
    switch (order.type) {
        case OrderType::Market:
            // Market orders don't need price
            break;
        case OrderType::Limit:
        case OrderType::StopLossLimit:
        case OrderType::TakeProfitLimit:
            if (order.price[0] <= 0) return false;
            break;
        case OrderType::StopLoss:
        case OrderType::TakeProfit:
            if (order.stop_price[0] <= 0) return false;
            break;
        case OrderType::TrailingStop:
            if (order.trailing_distance[0] <= 0) return false;
            break;
        case OrderType::OCO:
            // OCO needs both price and stop price
            if (order.price[0] <= 0 || order.stop_price[0] <= 0) return false;
            break;
        default:
            break;
    }
    
    // Quantity must be positive
    if (order.quantity[0] <= 0) return false;
    
    return true;
}

// ============================================================================
// ORDER FORMATTING
// ============================================================================

std::string order_to_string(const Order& order) {
    std::ostringstream oss;
    oss << "Order(";
    oss << "id=" << order.id.server_order_id;
    oss << ", symbol=" << order.symbol;
    oss << ", side=" << (order.side == OrderSide::Buy ? "BUY" : "SELL");
    oss << ", type=" << static_cast<int>(order.type);
    oss << ", price=" << order.price[0];
    oss << ", qty=" << order.quantity[0];
    oss << ", filled=" << order.filled_quantity[0];
    oss << ")";
    return oss.str();
}

std::string trade_to_string(const Trade& trade) {
    std::ostringstream oss;
    oss << "Trade(";
    oss << "id=" << trade.trade_id;
    oss << ", symbol=" << trade.symbol;
    oss << ", side=" << (trade.side == OrderSide::Buy ? "BUY" : "SELL");
    oss << ", price=" << trade.price[0];
    oss << ", qty=" << trade.quantity[0];
    oss << ", maker=" << trade.maker_order_id;
    oss << ", taker=" << trade.taker_order_id;
    oss << ")";
    return oss.str();
}

// ============================================================================
// ORDER SIDE HELPERS
// ============================================================================

bool is_buy_order(OrderSide side) {
    return side == OrderSide::Buy;
}

bool is_sell_order(OrderSide side) {
    return side == OrderSide::Sell;
}

OrderSide opposite_side(OrderSide side) {
    return side == OrderSide::Buy ? OrderSide::Sell : OrderSide::Buy;
}

// ============================================================================
// ORDER TYPE HELPERS
// ============================================================================

bool is_limit_order(OrderType type) {
    return type == OrderType::Limit || 
           type == OrderType::StopLossLimit ||
           type == OrderType::TakeProfitLimit;
}

bool is_market_order(OrderType type) {
    return type == OrderType::Market;
}

bool is_stop_order(OrderType type) {
    return type == OrderType::StopLoss || 
           type == OrderType::StopLossLimit;
}

bool is_take_profit_order(OrderType type) {
    return type == OrderType::TakeProfit || 
           type == OrderType::TakeProfitLimit;
}

bool is_iceberg_order(const Order& order) {
    return order.type == OrderType::Limit && 
           order.iceberg_visible[0] > 0 &&
           order.iceberg_visible[0] < order.quantity[0];
}

// ============================================================================
// TIME IN FORCE HELPERS
// ============================================================================

bool requires_price(OrderType type, TimeInForce tif) {
    if (type == OrderType::Market) {
        return tif != TimeInForce::FillOrKill && 
               tif != TimeInForce::ImmediateOrCancel;
    }
    return true;
}

bool is_good_till_cancel(TimeInForce tif) {
    return tif == TimeInForce::GoodTillCancel;
}

bool is_good_till_time(TimeInForce tif) {
    return tif == TimeInForce::GoodTillTime;
}

bool is_ioc(TimeInForce tif) {
    return tif == TimeInForce::ImmediateOrCancel;
}

bool is_fok(TimeInForce tif) {
    return tif == TimeInForce::FillOrKill;
}

bool is_post_only(TimeInForce tif) {
    return tif == TimeInForce::PostOnly;
}

// ============================================================================
// MARKET TYPE HELPERS
// ============================================================================

bool is_spot_market(MarketType type) {
    return type == MarketType::Spot;
}

bool is_margin_market(MarketType type) {
    return type == MarketType::Margin;
}

bool is_futures_market(MarketType type) {
    return type == MarketType::Futures;
}

bool is_options_market(MarketType type) {
    return type == MarketType::Option;
}

bool requires_margin(MarketType type) {
    return type == MarketType::Margin || 
           type == MarketType::Futures;
}

// ============================================================================
// PRICE PRECISION
// ============================================================================

int get_price_precision(const std::string& symbol) {
    // Common precision rules
    if (symbol.find("BTC") != std::string::npos) return 8;
    if (symbol.find("ETH") != std::string::npos) return 8;
    if (symbol.find("BNB") != std::string::npos) return 8;
    if (symbol.find("USDT") != std::string::npos ||
        symbol.find("USDC") != std::string::npos ||
        symbol.find("USD") != std::string::npos) return 2;
    return 8;  // Default
}

int get_quantity_precision(const std::string& symbol) {
    // Common precision rules
    if (symbol.find("BTC") != std::string::npos) return 8;
    if (symbol.find("ETH") != std::string::npos) return 8;
    return 2;  // Default for tokens
}

// ============================================================================
// FEE CALCULATION
// ============================================================================

int64_t calculate_fee(int64_t price, int64_t quantity, int32_t fee_rate_bps) {
    // fee = price * quantity * fee_rate / 10000
    return (price * quantity * fee_rate_bps) / 10000;
}

int64_t calculate_maker_fee(int64_t price, int64_t quantity) {
    // Maker fee: 0.02% = 2 bps
    return calculate_fee(price, quantity, 2);
}

int64_t calculate_taker_fee(int64_t price, int64_t quantity) {
    // Taker fee: 0.04% = 4 bps
    return calculate_fee(price, quantity, 4);
}

// ============================================================================
// ORDER SIZE LIMITS
// ============================================================================

int64_t get_min_order_size(const std::string& symbol) {
    if (symbol.find("BTC") != std::string::npos) return 10000;  // 0.0001 BTC
    if (symbol.find("ETH") != std::string::npos) return 100000000;  // 0.001 ETH
    return 100;  // Default
}

int64_t get_max_order_size(const std::string& symbol) {
    if (symbol.find("BTC") != std::string::npos) return 1000000000;  // 10 BTC
    if (symbol.find("ETH") != std::string::npos) return 100000000000;  // 1000 ETH
    return 1000000000;  // Default
}

int64_t get_min_notional(const std::string& symbol) {
    if (symbol.find("BTC") != std::string::npos) return 10000;  // $0.01
    return 1000000;  // $1.00 minimum notional
}

// ============================================================================
// PRICE VALIDATION
// ============================================================================

bool is_price_increment_valid(int64_t price, const std::string& symbol) {
    // Check price increment (usually 0.01 or 0.0001 for crypto)
    if (symbol.find("BTC") != std::string::npos) {
        return price % 100 == 0;  // 0.01 BTC precision
    }
    return price % 10000 == 0;  // 0.0001 for most tokens
}

bool is_quantity_increment_valid(int64_t quantity, const std::string& symbol) {
    // Check quantity increment
    if (symbol.find("BTC") != std::string::npos) {
        return quantity % 100 == 0;  // 0.0001 BTC
    }
    return quantity % 100 == 0;
}

} // namespace tigerex