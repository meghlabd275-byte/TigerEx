/**
 * TigerEx Order Book - C++ Ultra-Low Latency Implementation
 * High frequency trading order book with nanosecond precision
 */

#include <iostream>
#include <vector>
#include <map>
#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cmath>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <string>

// ============================================================================
// CONSTANTS
// ============================================================================

constexpr int MAX_PRICE_LEVELS = 100;
constexpr int MAX_ORDERS = 100000;

// ============================================================================
// ORDER DEFINITIONS
// ============================================================================

enum class OrderSide { BUY, SELL };
enum class OrderType { MARKET, LIMIT, STOP };
enum class OrderStatus { NEW, OPEN, FILLED, CANCELLED };

struct Order {
    uint64_t id;
    uint64_t user_id;
    std::string symbol;
    OrderSide side;
    OrderType type;
    double price;
    double quantity;
    double filled;
    OrderStatus status;
    uint64_t timestamp;
    uint64_t order_id;
};

// ============================================================================
// PRICE LEVEL
// ============================================================================

struct PriceLevel {
    double price;
    double quantity;
    uint64_t orders;

    PriceLevel(double p = 0.0, double q = 0.0) : price(p), quantity(q), orders(0) {}
};

// ============================================================================
// ORDER BOOK
// ============================================================================

class OrderBook {
private:
    std::map<double, PriceLevel> bids_;      // Buy orders (sorted desc)
    std::map<double, PriceLevel> asks_;    // Sell orders (sorted asc)
    std::map<uint64_t, Order> orders_;
    
    uint64_t counter_ = 0;

public:
    // Add order
    uint64_t add_order(OrderSide side, double price, double quantity, 
                      uint64_t user_id, const std::string& symbol) {
        counter_++;
        
        Order order{
            /*id*/ counter_,
            /*user_id*/ user_id,
            /*symbol*/ symbol,
            /*side*/ side,
            /*type*/ OrderType::LIMIT,
            /*price*/ price,
            /*quantity*/ quantity,
            /*filled*/ 0.0,
            /*status*/ OrderStatus::NEW,
            /*timestamp*/ get_timestamp_ns(),
            /*order_id*/ 0
        };
        
        orders_[counter_] = order;
        
        // Add to price level
        if (side == OrderSide::BUY) {
            bids_[price].quantity += quantity;
            bids_[price].orders++;
        } else {
            asks_[price].quantity += quantity;
            asks_[price].orders++;
        }
        
        return counter_;
    }

    // Cancel order
    bool cancel_order(uint64_t order_id) {
        auto it = orders_.find(order_id);
        if (it == orders_.end()) return false;
        
        Order& order = it->second;
        if (order.status == OrderStatus::FILLED ||
            order.status == OrderStatus::CANCELLED) {
            return false;
        }
        
        double remaining = order.quantity - order.filled;
        
        // Remove from price level
        if (order.side == OrderSide::BUY) {
            auto pit = bids_.find(order.price);
            if (pit != bids_.end()) {
                pit->second.quantity -= remaining;
                if (pit->second.quantity <= 0) bids_.erase(pit);
            }
        } else {
            auto pit = asks_.find(order.price);
            if (pit != asks_.end()) {
                pit->second.quantity -= remaining;
                if (pit->second.quantity <= 0) asks_.erase(pit);
            }
        }
        
        order.status = OrderStatus::CANCELLED;
        return true;
    }

    // Match orders (price-time priority)
    std::vector<Order> match_orders() {
        std::vector<Order> trades;
        
        while (!bids_.empty() && !asks_.empty()) {
            auto bid_it = std::prev(bids_.end()); // Highest bid
            auto ask_it = asks_.begin();         // Lowest ask
            
            double best_bid = bid_it->first;
            double best_ask = ask_it->first;
            
            if (best_bid >= best_ask) {
                // Match!
                double match_price = best_ask; // Maker pays
                double match_qty = std::min(
                    bid_it->second.quantity,
                    ask_it->second.quantity
                );
                
                // Create trades
                Order bid_order = orders_.begin()->second;
                // (Simplified - real implementation tracks specific orders)
                
                trades.push_back({
                    0, 0, "", OrderSide::BUY, OrderType::LIMIT,
                    match_price, match_qty, match_qty,
                    OrderStatus::FILLED, get_timestamp_ns(), 0
                });
                
                // Update quantities
                bid_it->second.quantity -= match_qty;
                ask_it->second.quantity -= match_qty;
                
                if (bid_it->second.quantity <= 0) {
                    bids_.erase(bid_it);
                }
                if (ask_it->second.quantity <= 0) {
                    asks_.erase(ask_it);
                }
            } else {
                break;
            }
        }
        
        return trades;
    }

    // Get best bid
    double get_best_bid() const {
        if (bids_.empty()) return 0.0;
        return std::prev(bids_.end())->first;
    }

    // Get best ask
    double get_best_ask() const {
        if (asks_.empty()) return 0.0;
        return asks_.begin()->first;
    }

    // Get spread
    double get_spread() const {
        return get_best_ask() - get_best_bid();
    }

    // Get depth
    void get_depth(int levels, 
                 std::vector<std::pair<double, double>>& bids_out,
                 std::vector<std::pair<double, double>>& asks_out) const {
        int count = 0;
        for (auto it = std::prev(bids_.end()); 
             it != bids_.begin() && count < levels; --it) {
            bids_out.push_back({it->first, it->second.quantity});
            count++;
        }
        
        count = 0;
        for (auto it = asks_.begin(); 
             it != asks_.end() && count < levels; ++it) {
            asks_out.push_back({it->first, it->second.quantity});
            count++;
        }
    }

    // Get stats
    void get_stats() const {
        double bid_volume = 0.0;
        for (const auto& p : bids_) bid_volume += p.second.quantity;
        
        double ask_volume = 0.0;
        for (const auto& p : asks_) ask_volume += p.second.quantity;
        
        std::cout << "Order Book Stats:" << std::endl;
        std::cout << "  Bids: " << bids_.size() 
                  << " (" << bid_volume << ")" << std::endl;
        std::cout << "  Asks: " << asks_.size() 
                  << " (" << ask_volume << ")" << std::endl;
        std::cout << "  Spread: " << get_spread() << std::endl;
    }

private:
    // Get nanosecond timestamp
    uint64_t get_timestamp_ns() {
        auto now = std::chrono::high_resolution_clock::now();
        auto duration = now.time_since_epoch();
        return std::chrono::duration_cast<std::chrono::nanoseconds>(
            duration
        ).count();
    }
};

// ============================================================================
// MAIN
// ============================================================================

// Each non-empty, non-comment input line is:
// side,price,quantity,user_id,symbol   (side is BUY or SELL)
static bool load_orders(const std::string& path, OrderBook& book) {
    std::ifstream file(path);
    if (!file.is_open()) {
        std::cerr << "Cannot open order file: " << path << std::endl;
        return false;
    }

    std::string line;
    size_t loaded = 0;
    while (std::getline(file, line)) {
        if (line.empty() || line[0] == '#') continue;

        std::stringstream ss(line);
        std::string side_s, price_s, qty_s, user_s, symbol;
        if (!std::getline(ss, side_s, ',') || !std::getline(ss, price_s, ',') ||
            !std::getline(ss, qty_s, ',') || !std::getline(ss, user_s, ',') ||
            !std::getline(ss, symbol, ',')) {
            std::cerr << "Malformed order line: " << line << std::endl;
            return false;
        }

        try {
            OrderSide side;
            if (side_s == "BUY") side = OrderSide::BUY;
            else if (side_s == "SELL") side = OrderSide::SELL;
            else throw std::invalid_argument("side");

            size_t c1 = 0, c2 = 0, c3 = 0;
            double price = std::stod(price_s, &c1);
            double qty = std::stod(qty_s, &c2);
            unsigned long long user = std::stoull(user_s, &c3);
            if (c1 != price_s.size() || c2 != qty_s.size() || c3 != user_s.size())
                throw std::invalid_argument("trailing characters");
            if (!std::isfinite(price) || !std::isfinite(qty) || price <= 0 || qty <= 0 ||
                symbol.empty())
                throw std::invalid_argument("range");

            book.add_order(side, price, qty, user, symbol);
            ++loaded;
        } catch (const std::exception&) {
            std::cerr << "Invalid order value in line: " << line << std::endl;
            return false;
        }
    }

    if (loaded == 0) {
        std::cerr << "Order file contained no orders: " << path << std::endl;
        return false;
    }
    return true;
}

#ifndef TIGEREX_ORDER_BOOK_NO_MAIN
int main(int argc, char** argv) {
    if (argc < 2) {
        std::cerr << "usage: order-book <orders.csv>" << std::endl;
        return 1;
    }

    OrderBook book;
    if (!load_orders(argv[1], book)) {
        return 1;
    }

    book.get_stats();
    std::cout << "\nBest Bid: " << book.get_best_bid() << std::endl;
    std::cout << "Best Ask: " << book.get_best_ask() << std::endl;
    std::cout << "Spread: " << book.get_spread() << std::endl;

    auto trades = book.match_orders();
    std::cout << "\nMatched " << trades.size() << " trades" << std::endl;

    return 0;
}
#endif // TIGEREX_ORDER_BOOK_NO_MAIN