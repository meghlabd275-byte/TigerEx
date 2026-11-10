/**
 * TigerEx Market Making Bot - C++
 * Spread capture and liquidity provision
 */

#include <iostream>
#include <vector>
#include <map>
#include <cstdint>
#include <algorithm>
#include <cmath>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <string>

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

    // A quote is two-sided: the bid and the ask sit symmetric around mid.
    static double calculate_bid(double mid, double spread) {
        return mid * (1 - spread / 2);
    }

    static double calculate_ask(double mid, double spread) {
        return mid * (1 + spread / 2);
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

    bool should_cancel(double /*current_spread*/) {
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

    uint64_t submit_order(double /*price*/, double size, bool /*is_buy*/) {
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
// INPUT
// ============================================================================

// Market snapshots are supplied as a CSV file (one snapshot per line:
// bid,ask,last,volume,volatility). Nothing is fabricated: without a readable
// file the program exits non-zero rather than quoting on invented prices.
static bool parse_snapshot(const std::string& line, MarketData& out) {
    std::stringstream ss(line);
    std::string bid_s, ask_s, last_s, vol_s, sigma_s;
    if (!std::getline(ss, bid_s, ',') || !std::getline(ss, ask_s, ',') ||
        !std::getline(ss, last_s, ',') || !std::getline(ss, vol_s, ',') ||
        !std::getline(ss, sigma_s, ',')) {
        return false;
    }
    try {
        out.bid = std::stod(bid_s);
        out.ask = std::stod(ask_s);
        out.last = std::stod(last_s);
        out.volume = std::stod(vol_s);
        out.volatility = std::stod(sigma_s);
        out.timestamp = 0;
    } catch (const std::exception&) {
        return false;
    }
    if (!std::isfinite(out.bid) || !std::isfinite(out.ask) || !std::isfinite(out.volume) ||
        !std::isfinite(out.volatility) || out.bid <= 0 || out.ask <= 0 || out.ask < out.bid ||
        out.volume < 0 || out.volatility < 0) {
        return false;
    }
    return true;
}

// ============================================================================
// MAIN
// ============================================================================

#ifndef TIGEREX_MARKET_MAKER_NO_MAIN
int main(int argc, char** argv) {
    if (argc < 3) {
        std::cerr << "usage: market-maker <symbol> <snapshots.csv>" << std::endl;
        return 1;
    }

    const std::string symbol = argv[1];
    std::ifstream file(argv[2]);
    if (!file.is_open()) {
        std::cerr << "Cannot open snapshot file: " << argv[2] << std::endl;
        return 1;
    }

    MarketMaker mm(symbol, 5);
    VolatilityTracker vt;
    std::string line;
    size_t processed = 0;

    while (std::getline(file, line)) {
        if (line.empty() || line[0] == '#') continue;

        MarketData market{};
        if (!parse_snapshot(line, market)) {
            std::cerr << "Invalid market snapshot: " << line << std::endl;
            return 1;
        }
        vt.add(market.last);
        auto quotes = mm.generate_quotes(market);
        std::cout << "bid=" << quotes.bid_price << " ask=" << quotes.ask_price
                  << " spread=" << (quotes.spread * 100) << "%" << std::endl;
        ++processed;
    }

    if (processed == 0) {
        std::cerr << "Snapshot file contained no snapshots: " << argv[2] << std::endl;
        return 1;
    }

    std::cout << "volatility=" << (vt.get_volatility() * 100) << "%" << std::endl;
    return 0;
}
#endif // TIGEREX_MARKET_MAKER_NO_MAIN
