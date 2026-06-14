/**
 * TigerEx Stock Trading Platform
 * Robinhood-style combined stock+crypto trading
 * 
 * Copyright (c) 2024 TigerEx
 */

#ifndef TIGEREX_STOCK_TRADING_HPP
#define TIGEREX_STOCK_TRADING_HPP

#include <vector>
#include <map>
#include <unordered_map>
#include <optional>
#include <memory>
#include <mutex>
#include <shared_mutex>
#include <atomic>
#include <chrono>
#include <string>
#include <cmath>

namespace tigerex {
namespace stock {

enum class StockOrderType { MARKET = 0, LIMIT = 1, STOP = 2, STOP_LIMIT = 3 };
enum class StockOrderSide { BUY = 0, SELL = 1 };
enum class StockOrderStatus { PENDING = 0, FILLED = 1, PARTIAL = 2, CANCELLED = 3, REJECTED = 4 };

struct StockListing {
    std::string symbol;
    std::string name;
    std::string exchange;
    std::string sector;
    double market_cap;
    double price;
    double change_24h;
    double change_percent_24h;
    double volume_24h;
    double high_52w;
    double low_52w;
    double pe_ratio;
    double dividend_yield;
    uint64_t shares_outstanding;
    bool is_active;
    StockListing() : market_cap(0), price(0), change_24h(0), change_percent_24h(0), volume_24h(0), high_52w(0), low_52w(0), pe_ratio(0), dividend_yield(0), shares_outstanding(0), is_active(true) {}
};

struct StockOrder {
    std::string order_id;
    std::string user_id;
    std::string symbol;
    StockOrderType type;
    StockOrderSide side;
    StockOrderStatus status;
    double quantity;
    double filled_quantity;
    double price;
    double avg_fill_price;
    double commission;
    uint64_t created_at;
    StockOrder() : type(StockOrderType::MARKET), side(StockOrderSide::BUY), status(StockOrderStatus::PENDING), quantity(0), filled_quantity(0), price(0), avg_fill_price(0), commission(0), created_at(0) {}
};

struct StockPosition {
    std::string position_id;
    std::string user_id;
    std::string symbol;
    double quantity;
    double avg_cost;
    double current_price;
    double market_value;
    double unrealized_pnl;
    double realized_pnl;
    uint64_t updated_at;
    StockPosition() : quantity(0), avg_cost(0), current_price(0), market_value(0), unrealized_pnl(0), realized_pnl(0), updated_at(0) {}
};

class StockTradingEngine {
private:
    std::unordered_map<std::string, StockListing> listings_;
    std::unordered_map<std::string, StockOrder> orders_;
    std::unordered_map<std::string, std::vector<StockPosition>> user_positions_;
    std::atomic<uint64_t> next_order_id_{1};
    std::atomic<uint64_t> total_volume_{0};
    std::atomic<uint64_t> total_trades_{0};
    mutable std::shared_mutex mutex_;

public:
    StockTradingEngine() { initialize_listings(); }
    
    void initialize_listings() {
        listings_["AAPL"] = {"AAPL", "Apple Inc.", "NASDAQ", "Technology", 3000000000000.0, 185.50, 2.50, 1.36, 52000000, 198.23, 164.08, 32.5, 0.55, 15500000000, true};
        listings_["MSFT"] = {"MSFT", "Microsoft Corporation", "NASDAQ", "Technology", 2800000000000.0, 378.20, 4.20, 1.12, 21000000, 420.82, 309.45, 36.2, 0.75, 7430000000, true};
        listings_["GOOGL"] = {"GOOGL", "Alphabet Inc.", "NASDAQ", "Technology", 1700000000000.0, 138.50, 1.80, 1.32, 25000000, 153.78, 115.35, 25.8, 0.0, 12300000000, true};
        listings_["AMZN"] = {"AMZN", "Amazon.com Inc.", "NASDAQ", "Consumer Cyclical", 1600000000000.0, 158.30, 2.10, 1.34, 45000000, 189.77, 118.35, 62.5, 0.0, 10300000000, true};
        listings_["NVDA"] = {"NVDA", "NVIDIA Corporation", "NASDAQ", "Technology", 2500000000000.0, 485.60, 12.40, 2.62, 55000000, 502.66, 222.97, 120.5, 0.03, 2460000000, true};
        listings_["META"] = {"META", "Meta Platforms Inc.", "NASDAQ", "Technology", 900000000000.0, 365.20, 5.30, 1.47, 18000000, 389.96, 274.38, 28.9, 0.35, 2580000000, true};
        listings_["TSLA"] = {"TSLA", "Tesla Inc.", "NASDAQ", "Consumer Cyclical", 750000000000.0, 235.40, -3.20, -1.34, 98000000, 299.29, 152.37, 75.2, 0.0, 3170000000, true};
        listings_["JPM"] = {"JPM", "JPMorgan Chase & Co.", "NYSE", "Financial", 520000000000.0, 172.50, 1.90, 1.11, 8500000, 200.94, 135.19, 11.2, 2.35, 2890000000, true};
        listings_["V"] = {"V", "Visa Inc.", "NYSE", "Financial", 520000000000.0, 265.30, 2.10, 0.80, 6200000, 290.96, 227.68, 30.5, 0.75, 2060000000, true};
        listings_["JNJ"] = {"JNJ", "Johnson & Johnson", "NYSE", "Healthcare", 380000000000.0, 158.40, 0.80, 0.51, 7100000, 175.97, 143.13, 15.8, 3.05, 2650000000, true};
        listings_["AMD"] = {"AMD", "Advanced Micro Devices", "NASDAQ", "Technology", 180000000000.0, 111.20, 2.80, 2.58, 52000000, 164.46, 93.12, 280.5, 0.0, 1620000000, true};
        listings_["COIN"] = {"COIN", "Coinbase Global Inc.", "NASDAQ", "Financial", 45000000000.0, 198.40, 5.60, 2.90, 8500000, 283.16, 78.12, 65.2, 0.0, 169000000, true};
        listings_["MSTR"] = {"MSTR", "MicroStrategy Inc.", "NASDAQ", "Technology", 25000000000.0, 1450.30, 45.20, 3.22, 1800000, 1999.99, 290.00, 1250.0, 0.0, 17300000, true};
    }
    
    std::optional<StockListing> get_listing(const std::string& symbol) const {
        std::shared_lock lock(mutex_);
        auto it = listings_.find(symbol);
        if (it != listings_.end()) return it->second;
        return std::nullopt;
    }
    
    std::vector<StockListing> get_all_listings() const {
        std::shared_lock lock(mutex_);
        std::vector<StockListing> result;
        for (const auto& [symbol, listing] : listings_) {
            if (listing.is_active) result.push_back(listing);
        }
        return result;
    }
    
    std::optional<std::string> place_order(const std::string& user_id, const std::string& symbol,
                                          StockOrderType order_type, StockOrderSide side,
                                          double quantity, double price = 0) {
        std::unique_lock lock(mutex_);
        
        auto listing_it = listings_.find(symbol);
        if (listing_it == listings_.end()) return std::nullopt;
        if (quantity <= 0) return std::nullopt;
        
        std::string order_id = "STK_" + std::to_string(next_order_id_.fetch_add(1));
        
        StockOrder order;
        order.order_id = order_id;
        order.user_id = user_id;
        order.symbol = symbol;
        order.type = order_type;
        order.side = side;
        order.status = StockOrderStatus::PENDING;
        order.quantity = quantity;
        order.price = price;
        order.commission = 0;
        order.created_at = std::chrono::system_clock::now().time_since_epoch().count();
        
        if (order_type == StockOrderType::MARKET) {
            double exec_price = listing_it->second.price;
            order.status = StockOrderStatus::FILLED;
            order.filled_quantity = quantity;
            order.avg_fill_price = exec_price;
            
            update_position(user_id, symbol, side, quantity, exec_price);
            total_volume_.fetch_add((uint64_t)(quantity * exec_price));
            total_trades_.fetch_add(1);
        }
        
        orders_[order_id] = order;
        return order_id;
    }
    
    std::vector<StockPosition> get_positions(const std::string& user_id) const {
        std::shared_lock lock(mutex_);
        auto it = user_positions_.find(user_id);
        if (it != user_positions_.end()) return it->second;
        return {};
    }
    
    uint64_t get_total_volume() const { return total_volume_.load(); }
    uint64_t get_total_trades() const { return total_trades_.load(); }
    
private:
    void update_position(const std::string& user_id, const std::string& symbol, StockOrderSide side, double quantity, double price) {
        auto& positions = user_positions_[user_id];
        
        for (auto& pos : positions) {
            if (pos.symbol == symbol) {
                if (side == StockOrderSide::BUY) {
                    double total_cost = pos.avg_cost * pos.quantity + price * quantity;
                    pos.quantity += quantity;
                    pos.avg_cost = total_cost / pos.quantity;
                } else {
                    pos.quantity -= quantity;
                    pos.realized_pnl += (price - pos.avg_cost) * quantity;
                }
                pos.updated_at = std::chrono::system_clock::now().time_since_epoch().count();
                return;
            }
        }
        
        StockPosition new_pos;
        new_pos.position_id = user_id + "_" + symbol;
        new_pos.user_id = user_id;
        new_pos.symbol = symbol;
        new_pos.quantity = quantity;
        new_pos.avg_cost = price;
        new_pos.current_price = price;
        new_pos.market_value = quantity * price;
        new_pos.updated_at = std::chrono::system_clock::now().time_since_epoch().count();
        positions.push_back(new_pos);
    }
};

} // namespace stock
} // namespace tigerex

#endif // TIGEREX_STOCK_TRADING_HPP