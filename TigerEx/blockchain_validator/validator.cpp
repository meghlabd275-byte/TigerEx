/**
 * TigerEx Blockchain Validator
 * High-performance block validation
 * Built with C++ for ultra-low latency
 */

#include <iostream>
#include <vector>
#include <string>
#include <map>
#include <atomic>
#include <thread>
#include <chrono>
#include <mutex>

constexpr int MAX_VALIDATORS = 100;
constexpr int BLOCK_SIZE = 1000;

struct Block {
    uint64_t height;
    uint64_t timestamp;
    std::string prev_hash;
    std::string merkle_root;
    std::vector<std::string> transactions;
    std::string validator_sig;
    uint64_t tx_count;
};

struct Validator {
    std::string id;
    std::string address;
    uint64_t stake;
    bool is_active;
    uint64_t validated_blocks;
};

class BlockchainValidator {
private:
    std::map<std::string, Validator> validators_;
    std::atomic<uint64_t> total_validated_{0};
    std::atomic<uint64_t> total_rejected_{0};
    std::atomic<uint64_t> current_height_{0};
    std::mutex mutex_;
    
public:
    BlockchainValidator() {
        std::cout << "Blockchain Validator initialized\n";
    }
    
    void addValidator(std::string id, std::string address, uint64_t stake) {
        std::lock_guard<std::mutex> lock(mutex_);
        validators_[id] = {id, address, stake, true, 0};
    }
    
    bool validateBlock(const Block& block) {
        // Verify block structure
        if (block.transactions.empty()) {
            return false;
        }
        
        // Verify merkle root
        std::string merkle = calculateMerkleRoot(block.transactions);
        if (merkle != block.merkle_root) {
            total_rejected_.fetch_add(1);
            return false;
        }
        
        // Verify previous block hash
        if (!verifyPrevHash(block)) {
            total_rejected_.fetch_add(1);
            return false;
        }
        
        // Verify transactions
        for (const auto& tx : block.transactions) {
            if (!verifyTransaction(tx)) {
                total_rejected_.fetch_add(1);
                return false;
            }
        }
        
        total_validated_.fetch_add(1);
        current_height_.store(block.height);
        
        return true;
    }
    
    std::string calculateMerkleRoot(const std::vector<std::string>& txs) {
        if (txs.empty()) return "";
        if (txs.size() == 1) return txs[0];
        
        std::vector<std::string> current = txs;
        while (current.size() > 1) {
            std::vector<std::string> next;
            for (size_t i = 0; i < current.size(); i += 2) {
                std::string combined = current[i];
                if (i + 1 < current.size()) {
                    combined += current[i + 1];
                }
                next.push_back(hashString(combined));
            }
            current = next;
        }
        
        return current[0];
    }
    
    std::string hashString(const std::string& s) {
        std::hash<std::string> hasher;
        return std::to_string(hasher(s));
    }
    
    bool verifyPrevHash(const Block& block) {
        return !block.prev_hash.empty();
    }
    
    bool verifyTransaction(const std::string& tx) {
        return !tx.empty() && tx.length() > 10;
    }
    
    std::vector<Validator> getActiveValidators() {
        std::lock_guard<std::mutex> lock(mutex_);
        std::vector<Validator> result;
        for (auto& v : validators_) {
            if (v.second.is_active) {
                result.push_back(v.second);
            }
        }
        return result;
    }
    
    void printStats() {
        std::cout << "\n=== Validator Stats ===\n";
        std::cout << "Total Validated: " << total_validated_.load() << "\n";
        std::cout << "Total Rejected: " << total_rejected_.load() << "\n";
        std::cout << "Current Height: " << current_height_.load() << "\n";
    }
};

int main() {
    std::cout << "TigerEx Blockchain Validator\n";
    std::cout << "=========================\n";
    
    BlockchainValidator validator;
    
    validator.addValidator("val1", "0xABC1", 1000000);
    validator.addValidator("val2", "0xABC2", 2000000);
    validator.addValidator("val3", "0xABC3", 1500000);
    
    Block block = {
        100,
        1699999999,
        "0000000000000000",
        "abc123hash",
        {"tx1", "tx2", "tx3"},
        "sig123",
        3
    };
    
    bool valid = validator.validateBlock(block);
    std::cout << "Block valid: " << (valid ? "true" : "false") << "\n";
    
    validator.printStats();
    
    return 0;
}
