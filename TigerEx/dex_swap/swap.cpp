/**
 * TigerEx DEX Swap Engine
 * Built with C++ for ultra-low latency
 */

#include <iostream>
#include <string>
#include <map>
#include <vector>
#include <atomic>
#include <mutex>

constexpr double FEE_RATE = 0.003; // 0.3%

struct Token {
    std::string symbol;
    std::string name;
    double price;
    double reserveA;
    double reserveB;
};

struct SwapPair {
    std::string tokenA;
    std::string tokenB;
    double reserveA;
    double reserveB;
};

struct SwapResult {
    std::string fromToken;
    std::string toToken;
    double fromAmount;
    double toAmount;
    double fee;
    double priceImpact;
};

class SwapEngine {
private:
    std::map<std::string, Token> tokens;
    std::map<std::string, SwapPair> pairs;
    std::atomic<uint64_t> swapCount{0};
    std::mutex mutex;
    
public:
    SwapEngine() {
        initTokens();
        initPairs();
    }
    
    void initTokens() {
        tokens["ETH"] = {"ETH", "Ethereum", 2500, 10000, 0};
        tokens["BTC"] = {"BTC", "Bitcoin", 50000, 1000, 0};
        tokens["USDT"] = {"USDT", "Tether", 1, 50000000, 0};
        tokens["BNB"] = {"BNB", "Binance Coin", 350, 5000, 0};
        tokens["SOL"] = {"SOL", "Solana", 100, 10000, 0};
        tokens["DOGE"] = {"DOGE", "Dogecoin", 0.08, 1000000, 0};
    }
    
    void initPairs() {
        pairs["ETH-USDT"] = {"ETH", "USDT", 10000, 25000000};
        pairs["BTC-USDT"] = {"BTC", "USDT", 1000, 50000000};
        pairs["BNB-USDT"] = {"BNB", "USDT", 5000, 1750000};
        pairs["SOL-USDT"] = {"SOL", "USDT", 10000, 1000000};
        pairs["DOGE-USDT"] = {"DOGE", "USDT", 1000000, 80000};
    }
    
    SwapResult swap(std::string from, std::string to, double amount) {
        std::lock_guard<std::mutex> lock(mutex);
        
        std::string pairKey = from + "-" + to;
        if (pairs.find(pairKey) == pairs.end()) {
            // Try reverse
            pairKey = to + "-" + from;
            if (pairs.find(pairKey) == pairs.end()) {
                return {"", "", 0, 0, 0, 0};
            }
        }
        
        SwapPair& pair = pairs[pairKey];
        
        // Calculate output using AMM formula
        double reserveIn = (from == pair.tokenA) ? pair.reserveA : pair.reserveB;
        double reserveOut = (from == pair.tokenA) ? pair.reserveB : pair.reserveA;
        
        double amountWithFee = amount * (1 - FEE_RATE);
        double outputAmount = (reserveOut * amountWithFee) / (reserveIn + amountWithFee);
        
        // Update reserves
        if (from == pair.tokenA) {
            pair.reserveA += amount;
            pair.reserveB -= outputAmount;
        } else {
            pair.reserveB += amount;
            pair.reserveA -= outputAmount;
        }
        
        swapCount++;
        
        // Calculate price impact
        double priceImpact = (outputAmount / amount) / (reserveOut / reserveIn) - 1;
        
        return {from, to, amount, outputAmount, amount * FEE_RATE, priceImpact * 100};
    }
    
    double getPrice(std::string tokenA, std::string tokenB) {
        std::string pairKey = tokenA + "-" + tokenB;
        if (pairs.find(pairKey) == pairs.end()) {
            pairKey = tokenB + "-" + tokenA;
        }
        
        if (pairs.find(pairKey) == pairs.end()) return 0;
        
        SwapPair& pair = pairs[pairKey];
        if (pair.tokenA == tokenA) {
            return pair.reserveB / pair.reserveA;
        }
        return pair.reserveA / pair.reserveB;
    }
    
    uint64_t getSwapCount() { return swapCount.load(); }
};

int main() {
    std::cout << "TigerEx DEX Swap Engine\n";
    std::cout << "======================\n";
    
    SwapEngine engine;
    
    // Swap ETH to USDT
    auto result = engine.swap("ETH", "USDT", 1.0);
    std::cout << "\nSwap 1 ETH to USDT:\n";
    std::cout << "  Output: " << result.toAmount << " USDT\n";
    std::cout << "  Fee: " << result.fee << " ETH\n";
    std::cout << "  Price Impact: " << result.priceImpact << "%\n";
    
    // Swap BTC to USDT
    result = engine.swap("BTC", "USDT", 0.1);
    std::cout << "\nSwap 0.1 BTC to USDT:\n";
    std::cout << "  Output: " << result.toAmount << " USDT\n";
    
    // Get prices
    std::cout << "\nPrices:\n";
    std::cout << "  ETH-USDT: " << engine.getPrice("ETH", "USDT") << "\n";
    std::cout << "  BTC-USDT: " << engine.getPrice("BTC", "USDT") << "\n";
    std::cout << "  DOGE-USDT: " << engine.getPrice("DOGE", "USDT") << "\n";
    
    std::cout << "\nTotal Swaps: " << engine.getSwapCount() << "\n";
    
    return 0;
}
