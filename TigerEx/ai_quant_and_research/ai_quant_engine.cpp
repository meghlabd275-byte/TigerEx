/**
 * TigerEx AI Quantitative Research Engine
 * 
 * High-performance AI trading research and analysis
 * Built with C++ for ultra-low latency
 * 
 * Copyright (c) 2024 TigerEx
 */

#include <iostream>
#include <vector>
#include <map>
#include <string>
#include <cmath>
#include <random>
#include <chrono>
#include <algorithm>
#include <memory>
#include <thread>
#include <mutex>
#include <atomic>

// ============================================================================
// CONFIGURATION
// ============================================================================

constexpr int MAX_DATA_POINTS = 1000000;
constexpr int WINDOW_SIZE = 100;
constexpr double RISK_FREE_RATE = 0.02;

// ============================================================================
// DATA STRUCTURES
// ============================================================================

struct MarketData {
    double open;
    double high;
    double low;
    double close;
    double volume;
    int64_t timestamp;
};

struct Signal {
    std::string symbol;
    double strength;  // -1 to 1
    std::string direction;  // "BUY" or "SELL"
    double confidence;
    int64_t timestamp;
};

struct PortfolioPosition {
    std::string symbol;
    double quantity;
    double entry_price;
    double current_price;
    double pnl;
};

struct BacktestResult {
    double total_return;
    double sharpe_ratio;
    double max_drawdown;
    double win_rate;
    int total_trades;
    double profit_factor;
};

// ============================================================================
// MATHEMATICAL FUNCTIONS
// ============================================================================

class MathUtils {
public:
    static double calculateMean(const std::vector<double>& data) {
        if (data.empty()) return 0.0;
        double sum = 0.0;
        for (const auto& d : data) sum += d;
        return sum / data.size();
    }

    static double calculateStdDev(const std::vector<double>& data) {
        if (data.size() < 2) return 0.0;
        double mean = calculateMean(data);
        double variance = 0.0;
        for (const auto& d : data) {
            variance += (d - mean) * (d - mean);
        }
        return std::sqrt(variance / (data.size() - 1));
    }

    static double calculateRSI(const std::vector<double>& prices, int period = 14) {
        if (prices.size() < period + 1) return 50.0;
        
        std::vector<double> gains;
        std::vector<double> losses;
        
        for (size_t i = 1; i < prices.size(); i++) {
            double change = prices[i] - prices[i-1];
            if (change > 0) {
                gains.push_back(change);
                losses.push_back(0);
            } else {
                gains.push_back(0);
                losses.push_back(std::abs(change));
            }
        }
        
        double avgGain = calculateMean(std::vector<double>(gains.end() - period, gains.end()));
        double avgLoss = calculateMean(std::vector<double>(losses.end() - period, losses.end()));
        
        if (avgLoss == 0) return 100.0;
        double rs = avgGain / avgLoss;
        return 100.0 - (100.0 / (1.0 + rs));
    }

    static double calculateEMA(const std::vector<double>& data, int period) {
        if (data.empty()) return 0.0;
        double multiplier = 2.0 / (period + 1);
        double ema = data[0];
        
        for (size_t i = 1; i < data.size(); i++) {
            ema = (data[i] - ema) * multiplier + ema;
        }
        return ema;
    }

    static double calculateBollingerBands(const std::vector<double>& data, int period, double stdDevMult) {
        double mean = calculateMean(data);
        double stdDev = calculateStdDev(data);
        return stdDevMult * stdDev;  // Band width
    }

    static double calculateMACD(const std::vector<double>& prices) {
        if (prices.size() < 26) return 0.0;
        double ema12 = calculateEMA(prices, 12);
        double ema26 = calculateEMA(prices, 26);
        return ema12 - ema26;
    }

    static double calculateStochastic(const std::vector<double>& highs, 
                                     const std::vector<double>& lows,
                                     const std::vector<double>& closes,
                                     int period = 14) {
        if (closes.size() < period) return 50.0;
        
        double highest = *std::max_element(highs.end() - period, highs.end());
        double lowest = *std::min_element(lows.end() - period, lows.end());
        double current = closes.back();
        
        if (highest == lowest) return 50.0;
        return 100.0 * (current - lowest) / (highest - lowest);
    }
};

// ============================================================================
// TECHNICAL INDICATORS
// ============================================================================

class TechnicalAnalyzer {
private:
    std::map<std::string, std::vector<MarketData>> marketDataStore;
    std::mutex dataMutex;

public:
    void addMarketData(const std::string& symbol, const MarketData& data) {
        std::lock_guard<std::mutex> lock(dataMutex);
        marketDataStore[symbol].push_back(data);
        
        // Keep only recent data
        if (marketDataStore[symbol].size() > MAX_DATA_POINTS) {
            marketDataStore[symbol].erase(marketDataStore[symbol].begin());
        }
    }

    std::vector<double> getPrices(const std::string& symbol) {
        std::lock_guard<std::mutex> lock(dataMutex);
        std::vector<double> prices;
        for (const auto& d : marketDataStore[symbol]) {
            prices.push_back(d.close);
        }
        return prices;
    }

    Signal analyzeRSI(const std::string& symbol, int period = 14) {
        auto prices = getPrices(symbol);
        if (prices.empty()) return {};
        
        double rsi = MathUtils::calculateRSI(prices, period);
        
        Signal signal;
        signal.symbol = symbol;
        signal.timestamp = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::system_clock::now().time_since_epoch()).count();
        
        if (rsi < 30) {
            signal.direction = "BUY";
            signal.strength = (30 - rsi) / 30;
            signal.confidence = signal.strength;
        } else if (rsi > 70) {
            signal.direction = "SELL";
            signal.strength = (rsi - 70) / 30;
            signal.confidence = signal.strength;
        } else {
            signal.direction = "HOLD";
            signal.strength = 0;
            signal.confidence = 0;
        }
        
        return signal;
    }

    Signal analyzeMACD(const std::string& symbol) {
        auto prices = getPrices(symbol);
        if (prices.empty()) return {};
        
        double macd = MathUtils::calculateMACD(prices);
        double signalLine = MathUtils::calculateEMA(prices, 9);
        
        Signal signal;
        signal.symbol = symbol;
        signal.timestamp = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::system_clock::now().time_since_epoch()).count();
        
        if (macd > signalLine) {
            signal.direction = "BUY";
            signal.strength = std::min(1.0, std::abs(macd) / 100.0);
        } else {
            signal.direction = "SELL";
            signal.strength = std::min(1.0, std::abs(macd) / 100.0);
        }
        signal.confidence = signal.strength;
        
        return signal;
    }

    Signal analyzeBollinger(const std::string& symbol, int period = 20) {
        auto prices = getPrices(symbol);
        if (prices.size() < period) return {};
        
        double mean = MathUtils::calculateMean(prices);
        double stdDev = MathUtils::calculateStdDev(prices);
        double current = prices.back();
        
        Signal signal;
        signal.symbol = symbol;
        signal.timestamp = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::system_clock::now().time_since_epoch()).count();
        
        if (current < mean - 2 * stdDev) {
            signal.direction = "BUY";
            signal.strength = 1.0;
        } else if (current > mean + 2 * stdDev) {
            signal.direction = "SELL";
            signal.strength = 1.0;
        } else {
            signal.direction = "HOLD";
            signal.strength = 0;
        }
        signal.confidence = signal.strength;
        
        return signal;
    }
};

// ============================================================================
// BACKTEST ENGINE
// ============================================================================

class BacktestEngine {
private:
    std::vector<Signal> signals;
    std::vector<PortfolioPosition> positions;
    double initialCapital;
    double currentCapital;
    double commission;

public:
    BacktestEngine(double capital, double comm = 0.001) 
        : initialCapital(capital), currentCapital(capital), commission(comm) {}

    void addSignal(const Signal& signal) {
        signals.push_back(signal);
    }

    void executeSignal(const Signal& signal, double price) {
        if (signal.direction == "BUY" && currentCapital > price) {
            double maxSpend = currentCapital * 0.1;  // 10% max position
            double quantity = maxSpend / price;
            double cost = quantity * price * (1 + commission);
            
            if (cost <= currentCapital) {
                PortfolioPosition pos;
                pos.symbol = signal.symbol;
                pos.quantity = quantity;
                pos.entry_price = price;
                pos.current_price = price;
                pos.pnl = 0;
                positions.push_back(pos);
                currentCapital -= cost;
            }
        }
    }

    BacktestResult run(const std::map<std::string, std::vector<double>>& priceData) {
        BacktestResult result;
        std::vector<double> returns;
        
        for (const auto& signal : signals) {
            auto it = priceData.find(signal.symbol);
            if (it != priceData.end() && !it->second.empty()) {
                executeSignal(signal, it->second.back());
            }
        }
        
        // Calculate portfolio value
        double finalValue = currentCapital;
        for (const auto& pos : positions) {
            auto it = priceData.find(pos.symbol);
            if (it != priceData.end() && !it->second.empty()) {
                finalValue += pos.quantity * it->second.back();
            }
        }
        
        result.total_return = (finalValue - initialCapital) / initialCapital;
        result.sharpe_ratio = calculateSharpe(returns);
        result.max_drawdown = calculateMaxDrawdown(returns);
        result.win_rate = calculateWinRate(returns);
        result.total_trades = signals.size();
        result.profit_factor = calculateProfitFactor(returns);
        
        return result;
    }

private:
    double calculateSharpe(const std::vector<double>& returns) {
        if (returns.empty()) return 0.0;
        double mean = MathUtils::calculateMean(returns);
        double stdDev = MathUtils::calculateStdDev(returns);
        if (stdDev == 0) return 0.0;
        return (mean - RISK_FREE_RATE) / stdDev * std::sqrt(252);
    }

    double calculateMaxDrawdown(const std::vector<double>& returns) {
        double maxDD = 0.0;
        double peak = 1.0;
        double value = 1.0;
        
        for (double r : returns) {
            value *= (1 + r);
            if (value > peak) peak = value;
            double dd = (peak - value) / peak;
            if (dd > maxDD) maxDD = dd;
        }
        
        return maxDD;
    }

    double calculateWinRate(const std::vector<double>& returns) {
        if (returns.empty()) return 0.0;
        int wins = 0;
        for (double r : returns) {
            if (r > 0) wins++;
        }
        return (double)wins / returns.size();
    }

    double calculateProfitFactor(const std::vector<double>& returns) {
        double profits = 0.0;
        double losses = 0.0;
        
        for (double r : returns) {
            if (r > 0) profits += r;
            else losses += std::abs(r);
        }
        
        if (losses == 0) return profits > 0 ? 999.0 : 0.0;
        return profits / losses;
    }
};

// ============================================================================
// MACHINE LEARNING MODEL
// ============================================================================

class MLPredictor {
private:
    std::vector<std::vector<double>> weights;
    std::vector<double> biases;
    int inputSize;
    int hiddenSize;
    int outputSize;
    double learningRate;

public:
    MLPredictor(int input, int hidden, int output, double lr = 0.001)
        : inputSize(input), hiddenSize(hidden), outputSize(output), learningRate(lr) {
        // Initialize weights randomly
        std::random_device rd;
        std::mt19937 gen(rd());
        std::normal_distribution<> d(0, 0.1);
        
        weights.resize(hidden);
        for (auto& w : weights) {
            w.resize(input);
            for (auto& v : w) v = d(gen);
        }
        
        biases.resize(hidden);
        for (auto& b : biases) b = d(gen);
    }

    std::vector<double> predict(const std::vector<double>& input) {
        if (input.size() != inputSize) return {};
        
        // Forward pass (simplified neural network)
        std::vector<double> hidden(hiddenSize);
        for (int i = 0; i < hiddenSize; i++) {
            hidden[i] = biases[i];
            for (int j = 0; j < inputSize; j++) {
                hidden[i] += weights[i][j] * input[j];
            }
            hidden[i] = std::tanh(hidden[i]);  // Activation
        }
        
        // Output layer (simple linear)
        std::vector<double> output(1);
        output[0] = 0;
        for (int i = 0; i < hiddenSize; i++) {
            output[0] += hidden[i] * weights[0][i];
        }
        
        return output;
    }

    void train(const std::vector<double>& input, const std::vector<double>& target) {
        // Simplified training (gradient descent would go here)
        // This is a placeholder for actual backpropagation
    }
};

// ============================================================================
// QUANT STRATEGY
// ============================================================================

class QuantStrategy {
private:
    TechnicalAnalyzer analyzer;
    BacktestEngine backtester;
    MLPredictor mlModel;

public:
    QuantStrategy(double capital) 
        : backtester(capital), mlModel(10, 20, 1) {}

    Signal generateSignal(const std::string& symbol) {
        // Combine multiple indicators
        Signal rsiSignal = analyzer.analyzeRSI(symbol);
        Signal macdSignal = analyzer.analyzeMACD(symbol);
        Signal bbSignal = analyzer.analyzeBollinger(symbol);
        
        // Weighted ensemble
        double buyScore = 0;
        double sellScore = 0;
        
        if (rsiSignal.direction == "BUY") buyScore += rsiSignal.strength * 0.3;
        if (rsiSignal.direction == "SELL") sellScore += rsiSignal.strength * 0.3;
        
        if (macdSignal.direction == "BUY") buyScore += macdSignal.strength * 0.4;
        if (macdSignal.direction == "SELL") sellScore += macdSignal.strength * 0.4;
        
        if (bbSignal.direction == "BUY") buyScore += bbSignal.strength * 0.3;
        if (bbSignal.direction == "SELL") sellScore += bbSignal.strength * 0.3;
        
        Signal finalSignal;
        finalSignal.symbol = symbol;
        finalSignal.timestamp = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::system_clock::now().time_since_epoch()).count();
        
        if (buyScore > sellScore && buyScore > 0.5) {
            finalSignal.direction = "BUY";
            finalSignal.strength = buyScore;
            finalSignal.confidence = buyScore;
        } else if (sellScore > buyScore && sellScore > 0.5) {
            finalSignal.direction = "SELL";
            finalSignal.strength = sellScore;
            finalSignal.confidence = sellScore;
        } else {
            finalSignal.direction = "HOLD";
            finalSignal.strength = 0;
            finalSignal.confidence = 0;
        }
        
        return finalSignal;
    }
};

// ============================================================================
// MAIN
// ============================================================================

int main() {
    std::cout << "TigerEx AI Quantitative Research Engine" << std::endl;
    std::cout << "=====================================" << std::endl;
    
    // Create strategy
    QuantStrategy strategy(100000.0);
    
    // Generate signals for multiple symbols
    std::vector<std::string> symbols = {"BTC/USDT", "ETH/USDT", "SOL/USDT"};
    
    for (const auto& symbol : symbols) {
        Signal signal = strategy.generateSignal(symbol);
        std::cout << "\n" << symbol << " Signal:" << std::endl;
        std::cout << "  Direction: " << signal.direction << std::endl;
        std::cout << "  Strength: " << signal.strength << std::endl;
        std::cout << "  Confidence: " << signal.confidence << std::endl;
    }
    
    return 0;
}
