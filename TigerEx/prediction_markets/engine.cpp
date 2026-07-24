#include <iostream>
#include <string>
#include <map>
#include <vector>
#include <atomic>
#include <mutex>
#include <chrono>

enum class MarketStatus { ACTIVE, SETTLED, CANCELLED };

struct Market {
    std::string id;
    std::string question;
    std::string category;
    std::vector<std::string> outcomes;
    std::map<std::string, double> odds;
    std::map<std::string, double> volumes;
    MarketStatus status;
    int64_t end_time;
    std::string result;
    double total_volume;
};

struct Bet {
    std::string id;
    std::string user_id;
    std::string market_id;
    std::string outcome;
    double amount;
    double potential_payout;
    int64_t timestamp;
    bool settled;
};

class PredictionEngine {
private:
    std::map<std::string, Market> markets;
    std::map<std::string, Bet> bets;
    std::atomic<uint64_t> bet_count{0};
    std::mutex mutex;
    
public:
    std::string createBinaryMarket(const std::string& question, const std::string& category, int64_t end_time) {
        std::lock_guard<std::mutex> lock(mutex);
        Market m;
        m.id = "PM_" + std::to_string(markets.size() + 1);
        m.question = question;
        m.category = category;
        m.outcomes = {"Yes", "No"};
        m.odds["Yes"] = 2.0;
        m.odds["No"] = 2.0;
        m.status = MarketStatus::ACTIVE;
        m.end_time = end_time;
        m.total_volume = 0.0;
        markets[m.id] = m;
        return m.id;
    }
    
    Bet placeBet(const std::string& user_id, const std::string& market_id, const std::string& outcome, double amount) {
        std::lock_guard<std::mutex> lock(mutex);
        if (markets.find(market_id) == markets.end()) return {};
        
        Market& m = markets[market_id];
        Bet b;
        b.id = "BET_" + std::to_string(++bet_count);
        b.user_id = user_id;
        b.market_id = market_id;
        b.outcome = outcome;
        b.amount = amount;
        b.potential_payout = amount * m.odds[outcome];
        b.timestamp = std::chrono::system_clock::now().time_since_epoch().count();
        b.settled = false;
        bets[b.id] = b;
        m.volumes[outcome] += amount;
        m.total_volume += amount;
        return b;
    }
    
    void settleMarket(const std::string& market_id, const std::string& result) {
        std::lock_guard<std::mutex> lock(mutex);
        if (markets.find(market_id) == markets.end()) return;
        markets[market_id].status = MarketStatus::SETTLED;
        markets[market_id].result = result;
    }
};

int main() {
    std::cout << "TigerEx Prediction Markets Engine\n";
    PredictionEngine engine;
    std::string m1 = engine.createBinaryMarket("Will BTC reach $100k?", "Crypto", 1735689600);
    std::cout << "Created: " << m1 << "\n";
    auto bet1 = engine.placeBet("user1", m1, "Yes", 100.0);
    std::cout << "Bet: " << bet1.id << " $" << bet1.amount << " payout: $" << bet1.potential_payout << "\n";
    engine.settleMarket(m1, "Yes");
    std::cout << "Settled: Yes\n";
    return 0;
}
