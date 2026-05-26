// OrderRouter - Routes orders to optimal execution venues
// Migrated from TypeScript to C++ for HFT-level performance

#include <iostream>
#include <unordered_map>
#include <vector>
#include <string>
#include <chrono>
#include <cmath>

using namespace std;

struct Venue {
    string name;
    string symbol;
    double bid;
    double ask;
    double volume24h;
    double fee;
    int latency_us;
};

struct OrderRoute {
    string venue;
    double price;
    double fee;
    double slippage;
};

class OrderRouter {
private:
    unordered_map<string, vector<Venue>> venues;
    chrono::high_resolution_clock::time_point lastUpdate;

public:
    OrderRouter() {
        lastUpdate = chrono::high_resolution_clock::now();
    }

    void addVenue(const string& symbol, const Venue& venue) {
        venues[symbol].push_back(venue);
    }

    // Best price routing
    OrderRoute getBestPriceRoute(const string& symbol, double quantity, bool isBuy) {
        vector<Venue>& symbolVenues = venues[symbol];
        
        OrderRoute best;
        best.price = isBuy ? INFINITY : 0;
        best.slippage = 0;
        
        for (const auto& venue : symbolVenues) {
            double price = isBuy ? venue.ask : venue.bid;
            
            // Skip if insufficient liquidity
            double available = venue.volume24h * venue.bid;
            if (available < quantity * price) continue;
            
            if (isBuy) {
                if (price < best.price) {
                    best.price = price;
                    best.venue = venue.name;
                    best.fee = venue.fee;
                }
            } else {
                if (price > best.price) {
                    best.price = price;
                    best.venue = venue.name;
                    best.fee = venue.fee;
                }
            }
        }
        
        // Calculate spread impact
        const auto& v = symbolVenues[0];
        double spread = (v.ask - v.bid) / v.bid;
        best.slippage = spread * 0.5;
        
        return best;
    }

    // Smart order routing with impact optimization
    OrderRoute getSmartRoute(const string& symbol, double quantity, bool isBuy) {
        vector<Venue>& symbolVenues = venues[symbol];
        
        // For large orders, split across venues
        double totalAvailable = 0;
        for (const auto& v : symbolVenues) {
            totalAvailable += v.volume24h;
        }
        
        // If order > 10% of daily volume, split
        double orderValue = quantity * symbolVenues[0].bid;
        if (orderValue > totalAvailable * 0.1) {
            return splitOrder(symbol, quantity, isBuy);
        }
        
        // Otherwise, use best price
        return getBestPriceRoute(symbol, quantity, isBuy);
    }

    OrderRoute splitOrder(const string& symbol, double quantity, bool isBuy) {
        OrderRoute route;
        route.price = 0;
        route.slippage = 0.001; // 0.1% for splitting
        
        vector<Venue>& symbolVenues = venues[symbol];
        
        // Weighted allocation
        double totalWeight = 0;
        for (const auto& v : symbolVenues) {
            totalWeight += v.volume24h;
        }
        
        // Primary venue
        double cumulative = 0;
        for (const auto& v : symbolVenues) {
            double weight = v.volume24h / totalWeight;
            double allocation = quantity * weight;
            
            if (allocation > cumulative) {
                route.price += (isBuy ? v.ask : v.bid) * weight;
                route.venue = v.name;
                break;
            }
            cumulative += allocation;
        }
        
        return route;
    }

    // Venue selection by latency
    OrderRoute getFastestRoute(const string& symbol, double quantity) {
        vector<Venue>& symbolVenues = venues[symbol];
        
        OrderRoute fastest;
        fastest.price = 0;
        int minLatency = INT_MAX;
        
        for (const auto& v : symbolVenues) {
            if (v.latency_us < minLatency && v.volume24h > 0) {
                minLatency = v.latency_us;
                fastest.venue = v.name;
                fastest.price = (v.bid + v.ask) / 2;
            }
        }
        
        return fastest;
    }

    // Fee optimization
    OrderRoute getCheapestRoute(const string& symbol, double quantity) {
        vector<Venue>& symbolVenues = venues[symbol];
        
        OrderRoute cheapest;
        cheapest.price = 0;
        cheapest.fee = INFINITY;
        
        for (const auto& v : symbolVenues) {
            if (v.fee < cheapest.fee) {
                cheapest.fee = v.fee;
                cheapest.venue = v.name;
                cheapest.price = (v.bid + v.ask) / 2;
            }
        }
        
        return cheapest;
    }
};

int main() {
    cout << "Order Router initialized" << endl;

    OrderRouter router;

    // Add mock venues
    router.addVenue("BTCUSDT", {"Binance", "BTCUSDT", 65000, 65001, 100000000, 0.001, 500});
    router.addVenue("BTCUSDT", {"Bybit", "BTCUSDT", 65000.5, 65001.5, 50000000, 0.0006, 300});
    router.addVenue("BTCUSDT", {"OKX", "BTCUSDT", 64999, 65002, 30000000, 0.0008, 400});

    // Get best price
    auto route = router.getBestPriceRoute("BTCUSDT", 1.0, true);
    cout << "Best route: " << route.venue << " @ $" << route.price << endl;

    // Get smart route
    auto smart = router.getSmartRoute("BTCUSDT", 100.0, true);
    cout << "Smart route: " << smart.venue << " (slippage: " << (smart.slippage * 100) << "%)" << endl;

    return 0;
}