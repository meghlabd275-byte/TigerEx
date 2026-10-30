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
#include <fstream>
#include <sstream>
#include <stdexcept>

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

    std::vector<MarketData> getCandles(const std::string& symbol) {
        std::lock_guard<std::mutex> lock(dataMutex);
        return marketDataStore[symbol];
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
        BacktestResult result{};
        std::vector<double> returns;

        double equity = initialCapital;
        double peakEquity = initialCapital;
        double maxDrawdown = 0.0;
        int wins = 0;
        int closedTrades = 0;
        double grossProfit = 0.0;
        double grossLoss = 0.0;

        for (const auto& signal : signals) {
            auto it = priceData.find(signal.symbol);
            if (it == priceData.end() || it->second.empty()) continue;
            if (signal.direction != "BUY" && signal.direction != "SELL") continue;

            double price = it->second.back();
            if (price <= 0.0) continue;

            double notional = currentCapital * 0.1;  // 10% of available capital
            double fee = notional * commission;
            double pnl = signal.direction == "BUY"
                ? notional * signal.strength - fee
                : notional * signal.strength * -1.0 - fee;

            currentCapital += pnl;
            equity = currentCapital;
            returns.push_back(pnl / initialCapital);

            if (pnl > 0) {
                wins++;
                grossProfit += pnl;
            } else {
                grossLoss += std::abs(pnl);
            }
            closedTrades++;

            peakEquity = std::max(peakEquity, equity);
            maxDrawdown = std::max(maxDrawdown, (peakEquity - equity) / peakEquity);
        }

        result.total_return = (equity - initialCapital) / initialCapital;
        result.sharpe_ratio = calculateSharpe(returns);
        result.max_drawdown = maxDrawdown;
        result.win_rate = closedTrades > 0 ? static_cast<double>(wins) / closedTrades : 0.0;
        result.total_trades = closedTrades;
        result.profit_factor = grossLoss > 0.0 ? grossProfit / grossLoss : (grossProfit > 0.0 ? 999.0 : 0.0);

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
    std::vector<std::vector<double>> hiddenWeights;  // [hiddenSize][inputSize]
    std::vector<double> hiddenBiases;                // [hiddenSize]
    std::vector<double> outputWeights;               // [hiddenSize]
    double outputBias;
    int inputSize;
    int hiddenSize;
    double learningRate;
    bool trained;

    static double sigmoid(double x) { return 1.0 / (1.0 + std::exp(-x)); }

    std::vector<double> forwardHidden(const std::vector<double>& input) const {
        std::vector<double> hidden(hiddenSize);
        for (int i = 0; i < hiddenSize; i++) {
            double sum = hiddenBiases[i];
            for (int j = 0; j < inputSize; j++) {
                sum += hiddenWeights[i][j] * input[j];
            }
            hidden[i] = std::tanh(sum);
        }
        return hidden;
    }

public:
    MLPredictor(int input, int hidden, double lr = 0.01, unsigned seed = 42)
        : outputBias(0.0), inputSize(input), hiddenSize(hidden),
          learningRate(lr), trained(false) {
        if (input <= 0 || hidden <= 0) {
            throw std::invalid_argument("MLPredictor dimensions must be positive");
        }

        // Seeded initialisation keeps runs reproducible; the weights are then
        // fitted by backpropagation rather than left at their random values.
        std::mt19937 gen(seed);
        std::normal_distribution<double> dist(0.0, 0.1);

        hiddenWeights.assign(hiddenSize, std::vector<double>(inputSize));
        for (auto& row : hiddenWeights) {
            for (auto& v : row) v = dist(gen);
        }
        hiddenBiases.resize(hiddenSize);
        for (auto& b : hiddenBiases) b = dist(gen);
        outputWeights.resize(hiddenSize);
        for (auto& w : outputWeights) w = dist(gen);
    }

    bool isTrained() const { return trained; }

    std::vector<double> predict(const std::vector<double>& input) const {
        if (!trained) {
            throw std::runtime_error("MLPredictor::predict called before train");
        }
        if (input.size() != static_cast<size_t>(inputSize)) {
            throw std::invalid_argument("MLPredictor::predict input size mismatch");
        }

        std::vector<double> hidden = forwardHidden(input);
        double output = outputBias;
        for (int i = 0; i < hiddenSize; i++) {
            output += hidden[i] * outputWeights[i];
        }
        return {sigmoid(output)};
    }

    // One gradient-descent step on mean-squared error.
    double train(const std::vector<double>& input, double target) {
        if (input.size() != static_cast<size_t>(inputSize)) {
            throw std::invalid_argument("MLPredictor::train input size mismatch");
        }
        if (target < 0.0 || target > 1.0) {
            throw std::invalid_argument("MLPredictor::train target must be in [0, 1]");
        }

        std::vector<double> hidden = forwardHidden(input);
        double logit = outputBias;
        for (int i = 0; i < hiddenSize; i++) logit += hidden[i] * outputWeights[i];
        double output = sigmoid(logit);

        double error = output - target;
        double outputGrad = error * output * (1.0 - output);

        for (int i = 0; i < hiddenSize; i++) {
            double hiddenGrad = outputGrad * outputWeights[i] * (1.0 - hidden[i] * hidden[i]);
            for (int j = 0; j < inputSize; j++) {
                hiddenWeights[i][j] -= learningRate * hiddenGrad * input[j];
            }
            hiddenBiases[i] -= learningRate * hiddenGrad;
            outputWeights[i] -= learningRate * outputGrad * hidden[i];
        }
        outputBias -= learningRate * outputGrad;
        trained = true;

        return error * error;
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

    void loadMarketData(const std::vector<MarketData>& candles) {
        for (const auto& candle : candles) {
            analyzer.addMarketData("TGR/RUSD", candle);
        }
    }


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

int main(int argc, char** argv) {
    if (argc < 2) {
        std::cerr << "usage: ai_quant_engine <candles.csv>" << std::endl;
        return 1;
    }

    std::ifstream input(argv[1]);
    if (!input.is_open()) {
        std::cerr << "cannot open candle file: " << argv[1] << std::endl;
        return 1;
    }

    std::string headerLine;
    if (!std::getline(input, headerLine)) {
        std::cerr << "candle file is empty" << std::endl;
        return 1;
    }
    if (headerLine.find("close") == std::string::npos) {
        std::cerr << "candle file must contain a close column" << std::endl;
        return 1;
    }

    TechnicalAnalyzer analyzer;
    std::string line;
    size_t rowCount = 0;
    while (std::getline(input, line)) {
        if (line.empty()) continue;
        std::stringstream ss(line);
        std::string field;
        std::vector<std::string> fields;
        while (std::getline(ss, field, ',')) fields.push_back(field);
        if (fields.size() < 6) {
            std::cerr << "malformed candle row: " << line << std::endl;
            return 1;
        }

        try {
            MarketData candle;
            candle.timestamp = std::stoll(fields[0]);
            candle.open = std::stod(fields[1]);
            candle.high = std::stod(fields[2]);
            candle.low = std::stod(fields[3]);
            candle.close = std::stod(fields[4]);
            candle.volume = std::stod(fields[5]);
            analyzer.addMarketData("TGR/RUSD", candle);
            rowCount++;
        } catch (const std::exception&) {
            std::cerr << "non-numeric candle row: " << line << std::endl;
            return 1;
        }
    }

    if (rowCount < 30) {
        std::cerr << "at least 30 candles are required, got " << rowCount << std::endl;
        return 1;
    }

    QuantStrategy strategy(100000.0);
    strategy.loadMarketData(analyzer.getCandles("TGR/RUSD"));

    Signal signal = strategy.generateSignal("TGR/RUSD");
    std::cout << "TigerEx AI Quantitative Research Engine" << std::endl;
    std::cout << "Bars loaded: " << rowCount << std::endl;
    std::cout << "TGR/RUSD signal:" << std::endl;
    std::cout << "  Direction: " << signal.direction << std::endl;
    std::cout << "  Strength: " << signal.strength << std::endl;
    std::cout << "  Confidence: " << signal.confidence << std::endl;

    return 0;
}