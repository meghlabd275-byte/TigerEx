/**
 * TigerEx Market Making Bot - C++
 * Spread capture and liquidity provision
 */

#include <iostream>
#include <vector>
#include <map>
#include <algorithm>
#include <cmath>

// ============================================================================
// CONFIG
// ============================================================================

const double MIN_SPREAD = 0.001;    // 0.1%
const double MAX_SPREAD = 0.05;   // 5%
const double DEFAULT_SIZE = 0.01;
const int MAX_POSITIONS = 10;

// ============================================================================
// MARKET DATA
// ============================================================================

struct MarketData {
    double bid;
    double ask;
    double last;
    double volume;
    double volatility;
    uint64_t timestamp;
};

struct Quote {
    double price;
    double size;
    uint64_t timestamp;
};

// ============================================================================
// STATISTICS
// ============================================================================

class VolatilityTracker {
private:
    std::vector<double> returns;
    size_t window;

public:
    VolatilityTracker(size_t w = 100) : window(w) {}

    void add(double price) {
        if (!returns.empty()) {
            double ret = (price - returns.back()) / returns.back();
            returns.push_back(ret);
            if (returns.size() > window) {
                returns.erase(returns.begin());
            }
        } else {
            returns.push_back(price);
        }
    }

    double get_volatility() {
        if (returns.size() < 2) return 0.01;
        
        double mean = 0;
        for (size_t i = 1; i < returns.size(); i++) {
            mean += returns[i];
        }
        mean /= returns.size();

        double var = 0;
        for (size_t i = 1; i < returns.size(); i++) {
            double diff = returns[i] - mean;
            var += diff * diff;
        }
        var /= returns.size();

        return std::sqrt(var);
    }
};

// ============================================================================
// SPREAD CALCULATOR
// ============================================================================

class SpreadCalculator {
public:
    static double calculate_spread(double volatility, double target_volume) {
        // Dynamic spread based on volatility
        double base_spread = volatility * 2;
        // Adjust for volume
        double volume_factor = std::log10(1 + target_volume) / 10;
        
        return std::max(MIN_SPREAD, std::min(MAX_SPREAD, base_spread + volume_factor));
    }

    static double calculate_quote Prices(double mid, double spread) {
        return mid * (1 - spread / 2);  // Bid
        return mid * (1 + spread / 2);   // Ask
    }
};

// ============================================================================
// MARKET MAKER
// ============================================================================

class MarketMaker {
private:
    std::string symbol;
    double inventory;
    double inventory_limit;
    double target_inventory;
    VolatilityTracker volatility;

public:
    MarketMaker(std::string sym, double inv_lim = 10) 
        : symbol(sym), inventory(0), inventory_limit(inv_lim), target_inventory(0) {}

    struct QuoteResult {
        double bid_price;
        double ask_price;
        double bid_size;
        double ask_size;
        double spread;
    };

    QuoteResult generate_quotes(const MarketData& market) {
        double mid = (market.bid + market.ask) / 2;
        
        // Add inventory skew
        double skew = (target_inventory - inventory) / inventory_limit;
        double adjusted_mid = mid * (1 + skew * 0.001);
        
        // Calculate spread
        double spread = SpreadCalculator::calculate_spread(
            market.volatility, market.volume
        );
        
        // Generate quotes
        QuoteResult qr;
        qr.bid_price = adjusted_mid * (1 - spread / 2);
        qr.ask_price = adjusted_mid * (1 + spread / 2);
        qr.bid_size = DEFAULT_SIZE;
        qr.ask_size = DEFAULT_SIZE;
        qr.spread = spread;
        
        return qr;
    }

    void update_inventory(double size, bool is_buy) {
        if (is_buy) {
            inventory += size;
        } else {
            inventory -= size;
        }
    }

    bool should_cancel(double current_spread) {
        // Cancel if inventory exceeds limits
        return std::abs(inventory) > inventory_limit;
    }

    double get_pnl(double entry, double current, bool is_long) {
        if (is_long) {
            return (current - entry) * inventory;
        }
        return (entry - current) * inventory;
    }
};

// ============================================================================
// ORDER MANAGER
// ============================================================================

class OrderManager {
private:
    std::map<uint64_t, double> orders;
    uint64_t next_id;

public:
    OrderManager() : next_id(1000) {}

    uint64_t submit_order(double price, double size, bool is_buy) {
        uint64_t id = next_id++;
        orders[id] = size;
        return id;
    }

    bool cancel_order(uint64_t id) {
        auto it = orders.find(id);
        if (it != orders.end()) {
            orders.erase(it);
            return true;
        }
        return false;
    }

    size_t get_order_count() {
        return orders.size();
    }
};

// ============================================================================
// MAIN
// ============================================================================

int main() {
    MarketMaker mm("BTC/USDT", 5);
    
    MarketData market = {49990, 50010, 50000, 1000, 0.02, 0};
    auto quotes = mm.generate_quotes(market);
    
    std::cout << "Market Maker Quotes:" << std::endl;
    std::cout << "  Bid: $" << quotes.bid_price << " (" << quotes.bid_size << ")" << std::endl;
    std::cout << "  Ask: $" << quotes.ask_price << " (" << quotes.ask_size << ")" << std::endl;
    std::cout << "  Spread: " << (quotes.spread * 100) << "%" << std::endl;
    
    VolatilityTracker vt;
    for (double p = 49000; p < 51000; p += 100) {
        vt.add(p);
    }
    std::cout << "\nVolatility: " << (vt.get_volatility() * 100) << "%" << std::endl;
    
    return 0;
}