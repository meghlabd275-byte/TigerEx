/**
 * TigerEx Time Series Database
 * High-performance time series storage
 * Built with C++ for ultra-low latency
 */

#include <iostream>
#include <vector>
#include <map>
#include <string>
#include <chrono>
#include <atomic>
#include <mutex>
#include <thread>
#include <cstring>

constexpr int MAX_SERIES = 100000;
constexpr int BATCH_SIZE = 1000;

struct DataPoint {
    uint64_t timestamp;
    double value;
    uint8_t flags;
};

struct TimeSeries {
    std::string name;
    std::vector<DataPoint> points;
    std::atomic<uint64_t> count{0};
    std::mutex mutex;
};

class TimeSeriesDB {
private:
    std::map<std::string, std::unique_ptr<TimeSeries>> series_;
    std::atomic<uint64_t> total_points_{0};
    std::atomic<uint64_t> queries_{0};
    
public:
    TimeSeriesDB() {
        std::cout << "TimeSeriesDB initialized\n";
    }
    
    void createSeries(const std::string& name) {
        series_[name] = std::make_unique<TimeSeries>();
        series_[name]->name = name;
    }
    
    void write(const std::string& name, uint64_t timestamp, double value) {
        auto it = series_.find(name);
        if (it == series_.end()) {
            createSeries(name);
            it = series_.find(name);
        }
        
        std::lock_guard<std::mutex> lock(it->second->mutex);
        it->second->points.push_back({timestamp, value, 0});
        it->second->count++;
        total_points_++;
    }
    
    void writeBatch(const std::string& name, const std::vector<std::pair<uint64_t, double>>& data) {
        auto it = series_.find(name);
        if (it == series_.end()) {
            createSeries(name);
            it = series_.find(name);
        }
        
        std::lock_guard<std::mutex> lock(it->second->mutex);
        for (auto& d : data) {
            it->second->points.push_back({d.first, d.second, 0});
            it->second->count++;
        }
        total_points_ += data.size();
    }
    
    std::vector<DataPoint> query(const std::string& name, uint64_t start, uint64_t end) {
        queries_++;
        std::vector<DataPoint> result;
        
        auto it = series_.find(name);
        if (it == series_.end()) return result;
        
        std::lock_guard<std::mutex> lock(it->second->mutex);
        for (auto& p : it->second->points) {
            if (p.timestamp >= start && p.timestamp <= end) {
                result.push_back(p);
            }
        }
        
        return result;
    }
    
    double aggregate(const std::string& name, uint64_t start, uint64_t end) {
        auto points = query(name, start, end);
        if (points.empty()) return 0.0;
        
        double sum = 0.0;
        for (auto& p : points) {
            sum += p.value;
        }
        return sum / points.size();
    }
    
    void compact() {
        for (auto& s : series_) {
            std::lock_guard<std::mutex> lock(s.second->mutex);
            // Keep last 10000 points
            if (s.second->points.size() > 10000) {
                s.second->points.erase(s.second->points.begin(), 
                    s.second->points.end() - 10000);
            }
        }
    }
    
    void printStats() {
        std::cout << "\n=== TimeSeriesDB Stats ===\n";
        std::cout << "Series: " << series_.size() << "\n";
        std::cout << "Total Points: " << total_points_.load() << "\n";
        std::cout << "Queries: " << queries_.load() << "\n";
    }
};

int main() {
    std::cout << "TigerEx Time Series Database\n";
    std::cout << "===========================\n";
    
    TimeSeriesDB db;
    
    // Create series
    db.createSeries("BTC-USDT.price");
    db.createSeries("ETH-USDT.price");
    db.createSeries("BTC-USDT.volume");
    
    // Write data
    auto now = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
    
    for (int i = 0; i < 1000; i++) {
        db.write("BTC-USDT.price", now + i * 1000, 50000.0 + (i % 100));
        db.write("ETH-USDT.price", now + i * 1000, 2500.0 + (i % 50));
    }
    
    // Query
    auto results = db.query("BTC-USDT.price", now, now + 500000);
    std::cout << "Query results: " << results.size() << "\n";
    
    // Aggregate
    double avg = db.aggregate("BTC-USDT.price", now, now + 500000);
    std::cout << "Average: " << avg << "\n";
    
    db.printStats();
    
    return 0;
}
