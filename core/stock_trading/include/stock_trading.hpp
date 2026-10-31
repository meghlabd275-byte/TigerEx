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

    StockListing()
        : market_cap(0), price(0), change_24h(0), change_percent_24h(0), volume_24h(0),
          high_52w(0), low_52w(0), pe_ratio(0), dividend_yield(0), shares_outstanding(0),
          is_active(false) {}

    StockListing(std::string sym, std::string nm, std::string exch, std::string sec, bool active)
        : symbol(std::move(sym)), name(std::move(nm)), exchange(std::move(exch)), sector(std::move(sec)),
          market_cap(0), price(0), change_24h(0), change_percent_24h(0), volume_24h(0),
          high_52w(0), low_52w(0), pe_ratio(0), dividend_yield(0), shares_outstanding(0),
          is_active(active) {}
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
    StockTradingEngine() = default;

    /// Registers a tradable listing. Reference data (name, exchange, sector)
    /// comes from the operator; prices are never seeded here. A listing starts
    /// without a price and cannot be traded until update_price() supplies one.
    void register_listing(const std::string& symbol, const std::string& name,
                          const std::string& exchange, const std::string& sector) {
        if (symbol.empty()) return;
        std::unique_lock lock(mutex_);
        listings_[symbol] = StockListing(symbol, name, exchange, sector, true);
    }

    /// Applies an observed market price and session statistics for a listing.
    /// Rejects non-finite or non-positive prices so a bad feed cannot be traded.
    bool update_price(const std::string& symbol, double price, double change_24h,
                      double volume_24h, double high_52w, double low_52w) {
        if (!std::isfinite(price) || price <= 0.0) return false;

        std::unique_lock lock(mutex_);
        auto it = listings_.find(symbol);
        if (it == listings_.end()) return false;

        auto& listing = it->second;
        listing.price = price;
        listing.change_24h = change_24h;
        listing.change_percent_24h = price > 0.0 ? (change_24h / price) * 100.0 : 0.0;
        listing.volume_24h = volume_24h;
        listing.high_52w = high_52w;
        listing.low_52w = low_52w;
        return true;
    }

    void set_active(const std::string& symbol, bool active) {
        std::unique_lock lock(mutex_);
        auto it = listings_.find(symbol);
        if (it != listings_.end()) it->second.is_active = active;
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
        if (!listing_it->second.is_active) return std::nullopt;
        if (!std::isfinite(quantity) || quantity <= 0.0) return std::nullopt;
        if (!std::isfinite(price) || price < 0.0) return std::nullopt;

        // A market order needs a real last price from the feed. Without one the
        // order is rejected rather than filled at an invented price.
        if (order_type == StockOrderType::MARKET) {
            if (!std::isfinite(listing_it->second.price) || listing_it->second.price <= 0.0) {
                return std::nullopt;
            }
        } else if (price <= 0.0) {
            return std::nullopt;
        }
        
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

    /// Fills a resting order at an observed execution price. Limit orders fill
    /// only when the market reaches the limit; stop orders only when it crosses
    /// the stop. Returns false when the order is unknown, already terminal, or
    /// the observed price does not satisfy it.
    bool fill_order(const std::string& order_id, double market_price) {
        std::unique_lock lock(mutex_);
        if (!std::isfinite(market_price) || market_price <= 0.0) return false;

        auto it = orders_.find(order_id);
        if (it == orders_.end()) return false;

        auto& order = it->second;
        if (order.status != StockOrderStatus::PENDING) return false;

        bool crosses = false;
        switch (order.type) {
            case StockOrderType::LIMIT:
                crosses = order.side == StockOrderSide::BUY
                    ? market_price <= order.price
                    : market_price >= order.price;
                break;
            case StockOrderType::STOP:
            case StockOrderType::STOP_LIMIT:
                crosses = order.side == StockOrderSide::BUY
                    ? market_price >= order.price
                    : market_price <= order.price;
                break;
            case StockOrderType::MARKET:
                crosses = true;
                break;
        }
        if (!crosses) return false;
        if (listings_.find(order.symbol) == listings_.end()) return false;

        if (order.side == StockOrderSide::SELL &&
            !has_sufficient_position(order.user_id, order.symbol, order.quantity)) {
            order.status = StockOrderStatus::REJECTED;
            return false;
        }

        order.status = StockOrderStatus::FILLED;
        order.filled_quantity = order.quantity;
        order.avg_fill_price = market_price;

        update_position(order.user_id, order.symbol, order.side, order.quantity, market_price);
        total_volume_.fetch_add(static_cast<uint64_t>(order.quantity * market_price));
        total_trades_.fetch_add(1);
        return true;
    }

    bool cancel_order(const std::string& order_id) {
        std::unique_lock lock(mutex_);
        auto it = orders_.find(order_id);
        if (it == orders_.end()) return false;
        if (it->second.status != StockOrderStatus::PENDING) return false;
        it->second.status = StockOrderStatus::CANCELLED;
        return true;
    }

    std::optional<StockOrder> get_order(const std::string& order_id) const {
        std::shared_lock lock(mutex_);
        auto it = orders_.find(order_id);
        if (it != orders_.end()) return it->second;
        return std::nullopt;
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
    bool has_sufficient_position(const std::string& user_id, const std::string& symbol, double quantity) const {
        auto it = user_positions_.find(user_id);
        if (it == user_positions_.end()) return false;
        for (const auto& pos : it->second) {
            if (pos.symbol == symbol) return pos.quantity >= quantity;
        }
        return false;
    }

    void update_position(const std::string& user_id, const std::string& symbol, StockOrderSide side, double quantity, double price) {
        auto& positions = user_positions_[user_id];
        
        for (auto& pos : positions) {
            if (pos.symbol == symbol) {
                if (side == StockOrderSide::BUY) {
                    double total_cost = pos.avg_cost * pos.quantity + price * quantity;
                    pos.quantity += quantity;
                    pos.avg_cost = total_cost / pos.quantity;
                } else {
                    if (pos.quantity < quantity) return;
                    pos.quantity -= quantity;
                    pos.realized_pnl += (price - pos.avg_cost) * quantity;
                }
                pos.current_price = price;
                pos.market_value = pos.quantity * price;
                pos.unrealized_pnl = (price - pos.avg_cost) * pos.quantity;
                pos.updated_at = std::chrono::system_clock::now().time_since_epoch().count();
                return;
            }
        }

        if (side == StockOrderSide::SELL) return;
        
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