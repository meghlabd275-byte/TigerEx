// OrderRouter - Routes orders to optimal execution venues
// Migrated from TypeScript to C++ for HFT-level performance

#include <iostream>
#include <fstream>
#include <sstream>
#include <unordered_map>
#include <vector>
#include <string>
#include <chrono>
#include <cmath>
#include <climits>
#include <stdexcept>

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
        OrderRoute best;
        best.price = isBuy ? INFINITY : 0;
        best.slippage = 0;
        best.fee = 0;

        auto it = venues.find(symbol);
        if (it == venues.end() || it->second.empty()) {
            // Fail closed: an unknown symbol has no route rather than a
            // fabricated one.
            best.venue = "";
            return best;
        }

        vector<Venue>& symbolVenues = it->second;

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
        
        // Spread impact is taken from the routed venue itself.
        for (const auto& v : symbolVenues) {
            if (v.name == best.venue && v.bid > 0) {
                double spread = (v.ask - v.bid) / v.bid;
                best.slippage = spread * 0.5;
                break;
            }
        }

        return best;
    }

    // Smart order routing with impact optimization
    OrderRoute getSmartRoute(const string& symbol, double quantity, bool isBuy) {
        auto it = venues.find(symbol);
        if (it == venues.end() || it->second.empty()) {
            return getBestPriceRoute(symbol, quantity, isBuy);
        }
        vector<Venue>& symbolVenues = it->second;

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
        
        auto it = venues.find(symbol);
        if (it == venues.end() || it->second.empty()) {
            route.venue = "";
            return route;
        }
        vector<Venue>& symbolVenues = it->second;

        // Weighted allocation
        double totalWeight = 0;
        for (const auto& v : symbolVenues) {
            totalWeight += v.volume24h;
        }
        if (totalWeight <= 0) {
            return getBestPriceRoute(symbol, quantity, isBuy);
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
        OrderRoute fastest;
        fastest.price = 0;
        fastest.fee = 0;
        fastest.slippage = 0;
        int minLatency = INT_MAX;

        auto it = venues.find(symbol);
        if (it == venues.end() || it->second.empty()) {
            fastest.venue = "";
            return fastest;
        }
        vector<Venue>& symbolVenues = it->second;

        for (const auto& v : symbolVenues) {
            // A venue can only be routed to if it can fill the order.
            double available = v.volume24h * v.bid;
            if (available < quantity * v.ask) continue;
            if (v.latency_us < minLatency) {
                minLatency = v.latency_us;
                fastest.venue = v.name;
                fastest.price = (v.bid + v.ask) / 2;
            }
        }
        
        return fastest;
    }

    // Fee optimization
    OrderRoute getCheapestRoute(const string& symbol, double quantity) {
        OrderRoute cheapest;
        cheapest.price = 0;
        cheapest.fee = INFINITY;
        cheapest.slippage = 0;

        auto it = venues.find(symbol);
        if (it == venues.end() || it->second.empty()) {
            cheapest.venue = "";
            return cheapest;
        }
        vector<Venue>& symbolVenues = it->second;

        for (const auto& v : symbolVenues) {
            // A venue can only be routed to if it can fill the order.
            double available = v.volume24h * v.bid;
            if (available < quantity * v.ask) continue;
            if (v.fee < cheapest.fee) {
                cheapest.fee = v.fee;
                cheapest.venue = v.name;
                cheapest.price = (v.bid + v.ask) / 2;
            }
        }
        
        return cheapest;
    }
};

// Parse a full numeric field, rejecting trailing garbage that stod/stoi would
// otherwise ignore ("12abc" -> 12).
static double parseDouble(const string& field) {
    size_t consumed = 0;
    double value = stod(field, &consumed);
    if (consumed != field.size()) throw invalid_argument("trailing characters: " + field);
    if (!isfinite(value)) throw invalid_argument("non-finite value: " + field);
    return value;
}

static int parseInt(const string& field) {
    size_t consumed = 0;
    int value = stoi(field, &consumed);
    if (consumed != field.size()) throw invalid_argument("trailing characters: " + field);
    return value;
}

// Load venues from a CSV file supplied on the command line. Each non-empty,
// non-comment line is: symbol,name,bid,ask,volume24h,fee,latency_us
// No venue data is fabricated: without a readable file the router reports the
// error and exits non-zero rather than inventing venues or prices.
static bool loadVenues(const string& path, OrderRouter& router) {
    ifstream file(path);
    if (!file.is_open()) {
        cerr << "Cannot open venue file: " << path << endl;
        return false;
    }

    string line;
    size_t loaded = 0;
    while (getline(file, line)) {
        if (line.empty() || line[0] == '#') continue;

        stringstream ss(line);
        string symbol, name, bid_s, ask_s, vol_s, fee_s, lat_s;
        if (!getline(ss, symbol, ',') || !getline(ss, name, ',') ||
            !getline(ss, bid_s, ',') || !getline(ss, ask_s, ',') ||
            !getline(ss, vol_s, ',') || !getline(ss, fee_s, ',') ||
            !getline(ss, lat_s, ',')) {
            cerr << "Malformed venue line: " << line << endl;
            return false;
        }

        try {
            Venue venue{
                name,
                symbol,
                parseDouble(bid_s),
                parseDouble(ask_s),
                parseDouble(vol_s),
                parseDouble(fee_s),
                parseInt(lat_s),
            };
            if (venue.bid <= 0 || venue.ask <= 0 || venue.ask < venue.bid ||
                venue.volume24h < 0 || venue.fee < 0 || venue.latency_us < 0) {
                cerr << "Out-of-range venue value in line: " << line << endl;
                return false;
            }
            router.addVenue(symbol, venue);
            ++loaded;
        } catch (const exception&) {
            cerr << "Invalid venue value in line: " << line << endl;
            return false;
        }
    }

    if (loaded == 0) {
        cerr << "Venue file contained no venues: " << path << endl;
        return false;
    }
    return true;
}

int main(int argc, char** argv) {
    if (argc < 4) {
        cerr << "usage: order-router <venues.csv> <symbol> <quantity>" << endl;
        return 1;
    }

    OrderRouter router;
    if (!loadVenues(argv[1], router)) {
        return 1;
    }

    const string symbol = argv[2];
    double quantity = 0.0;
    try {
        quantity = stod(argv[3]);
    } catch (const exception&) {
        cerr << "Invalid quantity: " << argv[3] << endl;
        return 1;
    }

    auto route = router.getBestPriceRoute(symbol, quantity, true);
    if (route.venue.empty()) {
        cerr << "No venue available for symbol " << symbol << endl;
        return 1;
    }
    cout << "Best route: " << route.venue << " @ $" << route.price << endl;

    auto smart = router.getSmartRoute(symbol, quantity, true);
    cout << "Smart route: " << smart.venue << " (slippage: " << (smart.slippage * 100) << "%)" << endl;

    return 0;
}