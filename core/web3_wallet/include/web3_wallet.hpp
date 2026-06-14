/**
 * TigerEx Web3 Wallet Integration
 * Non-custodial wallet support for major chains
 * Supports MetaMask, WalletConnect, Coinbase Wallet, Rainbow, Trust Wallet
 * 
 * Copyright (c) 2024 TigerEx
 * Licensed under MIT License
 */

#ifndef TIGEREX_WEB3_WALLET_HPP
#define TIGEREX_WEB3_WALLET_HPP

#include <vector>
#include <map>
#include <unordered_map>
#include <optional>
#include <functional>
#include <memory>
#include <mutex>
#include <shared_mutex>
#include <atomic>
#include <chrono>
#include <algorithm>
#include <random>
#include <string>
#include <variant>
#include <iomanip>

namespace tigerex {
namespace web3 {

// Chain IDs
enum class ChainId : uint32_t {
    ETHEREUM_MAINNET = 1,
    GOERLI = 5,
    SEPOLIA = 11155111,
    POLYGON = 137,
    POLYGON_MUMBAI = 80001,
    BSC = 56,
    BSC_TESTNET = 97,
    AVALANCHE = 43114,
    FANTOM = 250,
    ARBITRUM = 42161,
    OPTIMISM = 10,
    SOLANA = 101,
    SOLANA_DEVNET = 103,
    SOLANA_TESTNET = 101,
    AURORA = 1313161554,
    NEAR = 1313161555,
    CELO = 42220,
    GNOSIS = 100,
    BASE = 8453,
    BASE_SEPOLIA = 84532
};

// Wallet types
enum class WalletType : uint8_t {
    METAMASK = 0,
    WALLET_CONNECT = 1,
    COINBASE_WALLET = 2,
    RAINBOW = 3,
    TRUST_WALLET = 4,
    PHANTOM = 5,
    SOLFLARE = 6,
    LEDGER = 7,
    TREZOR = 8,
    KEYSTORE = 9,
    PRIVATE_KEY = 10
};

// Connection status
enum class ConnectionStatus : uint8_t {
    DISCONNECTED = 0,
    CONNECTING = 1,
    CONNECTED = 2,
    ERROR = 3,
    CHAIN_SWITCHING = 4
};

// Token information
struct Token {
    std::string address;
    std::string symbol;
    std::string name;
    uint8_t decimals;
    ChainId chain;
    double balance;
    double balance_usd;
    
    Token() : decimals(18), chain(ChainId::ETHEREUM_MAINNET), balance(0), balance_usd(0) {}
    
    bool is_native() const { return address.empty() || address == "0x0000000000000000000000000000000000000000"; }
};

// NFT information
struct NFT {
    std::string contract_address;
    std::string token_id;
    std::string name;
    std::string description;
    std::string image_url;
    std::string animation_url;
    std::string owner;
    uint64_t balance;
    
    NFT() : balance(1) {}
};

// Transaction
struct Transaction {
    std::string hash;
    std::string from;
    std::string to;
    std::string value;
    std::string data;
    std::string gas_price;
    std::string gas_limit;
    std::string nonce;
    uint64_t chain_id;
    std::string v, r, s;
    
    enum Status : uint8_t {
        PENDING = 0,
        CONFIRMED = 1,
        FAILED = 2
    } status;
    
    uint64_t block_number;
    uint64_t timestamp;
    uint64_t confirmations;
    
    Transaction() : chain_id(0), status(PENDING), block_number(0), timestamp(0), confirmations(0) {}
};

// Signed message
struct SignedMessage {
    std::string message;
    std::string signature;
    std::string address;
};

// Balance update callback
struct BalanceUpdate {
    std::string address;
    std::string token_address;
    double old_balance;
    double new_balance;
    ChainId chain;
};

// Chain change callback
struct ChainChange {
    ChainId old_chain;
    ChainId new_chain;
};

// Account change callback
struct AccountChange {
    std::string old_account;
    std::string new_account;
};

// Web3 Provider interface
class Web3Provider {
public:
    virtual ~Web3Provider() = default;
    
    virtual std::string get_provider_name() const = 0;
    virtual std::string get_version() const = 0;
    virtual bool is_installed() const = 0;
    virtual ConnectionStatus get_status() const = 0;
    
    // Connection
    virtual std::optional<std::string> connect() = 0;
    virtual bool disconnect() = 0;
    virtual std::optional<std::string> get_account() const = 0;
    virtual std::optional<ChainId> get_chain() const = 0;
    virtual bool switch_chain(ChainId chain) = 0;
    
    // Signing
    virtual std::optional<std::string> personal_sign(const std::string& message) = 0;
    virtual std::optional<std::string> signTypedData(const std::string& data) = 0;
    
    // Transactions
    virtual std::optional<std::string> send_transaction(const Transaction& tx) = 0;
    virtual std::optional<Transaction> get_transaction(const std::string& hash) = 0;
    virtual std::optional<std::vector<Transaction>> get_transactions(const std::string& address, uint32_t limit) = 0;
    
    // Balance
    virtual std::optional<double> get_balance(const std::string& address) = 0;
    virtual std::optional<double> get_token_balance(const std::string& address, const std::string& token) = 0;
    
    // Contract read
    virtual std::optional<std::string> call(const std::string& to, const std::string& data) = 0;
    
    // Event callbacks
    std::function<void(const BalanceUpdate&)> on_balance_change;
    std::function<void(const ChainChange&)> on_chain_change;
    std::function<void(const AccountChange&)> on_account_change;
    std::function<void(const std::string&)> on_disconnect;
    std::function<void(const std::string&)> on_connect;
};

// EIP-1193 provider wrapper
class EIP1193Provider : public Web3Provider {
private:
    std::string name_;
    std::string version_;
    bool is_injected_;
    ConnectionStatus status_;
    std::string account_;
    ChainId chain_;
    
    std::function<std::optional<std::string>(const std::vector<std::string>&) request_func_;
    
public:
    EIP1193Provider(const std::string& name, const std::string& version) 
        : name_(name), version_(version), is_injected_(false), status_(ConnectionStatus::DISCONNECTED), chain_(ChainId::ETHEREUM_MAINNET) {}
    
    std::string get_provider_name() const override { return name_; }
    std::string get_version() const override { return version_; }
    bool is_installed() const override { return is_injected_; }
    ConnectionStatus get_status() const override { return status_; }
    
    void set_request_function(std::function<std::optional<std::string>(const std::vector<std::string>&)> func) {
        request_func_ = func;
    }
    
    std::optional<std::string> connect() override {
        status_ = ConnectionStatus::CONNECTING;
        
        if (request_func_) {
            auto result = request_func_({"eth_requestAccounts"});
            if (result.has_value()) {
                status_ = ConnectionStatus::CONNECTED;
                return result.value();
            }
        }
        
        status_ = ConnectionStatus::ERROR;
        return std::nullopt;
    }
    
    bool disconnect() override {
        account_.clear();
        status_ = ConnectionStatus::DISCONNECTED;
        return true;
    }
    
    std::optional<std::string> get_account() const override {
        if (status_ != ConnectionStatus::CONNECTED) return std::nullopt;
        return account_;
    }
    
    std::optional<ChainId> get_chain() const override {
        if (status_ != ConnectionStatus::CONNECTED) return std::nullopt;
        return chain_;
    }
    
    bool switch_chain(ChainId chain) override {
        status_ = ConnectionStatus::CHAIN_SWITCHING;
        
        if (request_func_) {
            std::string chain_id = "0x" + std::to_string(static_cast<uint32_t>(chain));
            auto result = request_func_({"wallet_switchEthereumChain", 
                R"({"chainId":")" + chain_id + R"("})"});
            
            if (result.has_value()) {
                chain_ = chain;
                status_ = ConnectionStatus::CONNECTED;
                return true;
            }
        }
        
        status_ = ConnectionStatus::ERROR;
        return false;
    }
    
    std::optional<std::string> personal_sign(const std::string& message) override {
        if (!request_func_) return std::nullopt;
        return request_func_({"personal_sign", message, account_});
    }
    
    std::optional<std::string> signTypedData(const std::string& data) override {
        if (!request_func_) return std::nullopt;
        return request_func_({"eth_signTypedData_v4", account_, data});
    }
    
    std::optional<std::string> send_transaction(const Transaction& tx) override {
        if (!request_func_) return std::nullopt;
        
        // Would serialize tx
        return request_func_({"eth_sendTransaction"});
    }
    
    std::optional<Transaction> get_transaction(const std::string& hash) override {
        return std::nullopt;
    }
    
    std::optional<std::vector<Transaction>> get_transactions(const std::string& address, uint32_t limit) override {
        return std::nullopt;
    }
    
    std::optional<double> get_balance(const std::string& address) override {
        if (!request_func_) return std::nullopt;
        
        auto result = request_func_({"eth_getBalance", address, "latest"});
        if (!result.has_value()) return std::nullopt;
        
        // Parse hex balance
        return 0.0;
    }
    
    std::optional<double> get_token_balance(const std::string& address, const std::string& token) override {
        return std::nullopt;
    }
    
    std::optional<std::string> call(const std::string& to, const std::string& data) override {
        if (!request_func_) return std::nullopt;
        
        return request_func_({"eth_call", to, data});
    }
};

// WalletConnect v2 provider
class WalletConnectProvider : public Web3Provider {
private:
    std::string project_id_;
    std::string name_;
    ConnectionStatus status_;
    std::string account_;
    ChainId chain_;
    std::string session_;
    std::vector<std::string> pending_requests_;
    
public:
    WalletConnectProvider(const std::string& project_id, const std::string& name = "TigerEx")
        : project_id_(project_id), name_(name), status_(ConnectionStatus::DISCONNECTED), chain_(ChainId::ETHEREUM_MAINNET) {}
    
    std::string get_provider_name() const override { return "WalletConnect v2"; }
    std::string get_version() const override { return "2.0.0"; }
    bool is_installed() const override { return true; }
    ConnectionStatus get_status() const override { return status_; }
    
    std::optional<std::string> connect() override {
        status_ = ConnectionStatus::CONNECTING;
        // Would create WalletConnect session
        status_ = ConnectionStatus::CONNECTED;
        return account_;
    }
    
    bool disconnect() override {
        account_.clear();
        session_.clear();
        status_ = ConnectionStatus::DISCONNECTED;
        return true;
    }
    
    std::optional<std::string> get_account() const override {
        return account_.empty() ? std::nullopt : std::make_optional(account_);
    }
    
    std::optional<ChainId> get_chain() const override {
        return chain_;
    }
    
    bool switch_chain(ChainId chain) override {
        chain_ = chain;
        return true;
    }
    
    std::optional<std::string> personal_sign(const std::string& message) override {
        // Would send sign request via WalletConnect
        return std::nullopt;
    }
    
    std::optional<std::string> signTypedData(const std::string& data) override {
        return std::nullopt;
    }
    
    std::optional<std::string> send_transaction(const Transaction& tx) override {
        return std::nullopt;
    }
    
    std::optional<Transaction> get_transaction(const std::string& hash) override {
        return std::nullopt;
    }
    
    std::optional<std::vector<Transaction>> get_transactions(const std::string& address, uint32_t limit) override {
        return std::nullopt;
    }
    
    std::optional<double> get_balance(const std::string& address) override {
        return std::nullopt;
    }
    
    std::optional<double> get_token_balance(const std::string& address, const std::string& token) override {
        return std::nullopt;
    }
    
    std::optional<std::string> call(const std::string& to, const std::string& data) override {
        return std::nullopt;
    }
};

// Multi-chain wallet manager
class MultiChainWallet {
private:
    std::unordered_map<ChainId, std::unique_ptr<Web3Provider>> providers_;
    std::vector<std::string> connected_accounts_;
    ChainId current_chain_;
    mutable std::shared_mutex mutex_;
    
    // Account tracking
    struct AccountInfo {
        std::string address;
        ChainId chain;
        double balance;
        std::vector<Token> tokens;
        std::vector<NFT> nfts;
    };
    
    std::unordered_map<std::string, AccountInfo> accounts_;
    
public:
    MultiChainWallet() : current_chain_(ChainId::ETHEREUM_MAINNET) {}
    
    // Add provider
    void add_provider(ChainId chain, std::unique_ptr<Web3Provider> provider) {
        std::unique_lock lock(mutex_);
        providers_[chain] = std::move(provider);
    }
    
    // Connect to chain
    std::optional<std::string> connect(ChainId chain) {
        std::unique_lock lock(mutex_);
        
        auto it = providers_.find(chain);
        if (it == providers_.end()) {
            return std::nullopt;
        }
        
        auto account = it->second->connect();
        if (account.has_value()) {
            current_chain_ = chain;
            connected_accounts_.push_back(account.value());
        }
        
        return account;
    }
    
    // Disconnect
    bool disconnect(ChainId chain) {
        std::unique_lock lock(mutex_);
        
        auto it = providers_.find(chain);
        if (it == providers_.end()) {
            return false;
        }
        
        return it->second->disconnect();
    }
    
    // Get current account
    std::optional<std::string> get_current_account() const {
        std::shared_lock lock(mutex_);
        
        if (current_chain_ == ChainId::SOLANA || current_chain_ == ChainId::SOLANA_DEVNET) {
            // Return SOL address
            return std::nullopt;
        }
        
        auto it = providers_.find(current_chain_);
        if (it == providers_.end()) {
            return std::nullopt;
        }
        
        return it->second->get_account();
    }
    
    // Switch chain
    bool switch_chain(ChainId chain) {
        std::unique_lock lock(mutex_);
        
        auto it = providers_.find(chain);
        if (it == providers_.end()) {
            return false;
        }
        
        if (!it->second->get_account().has_value()) {
            return false;
        }
        
        return it->second->switch_chain(chain);
    }
    
    // Sign message
    std::optional<std::string> sign_message(const std::string& message) {
        std::shared_lock lock(mutex_);
        
        auto it = providers_.find(current_chain_);
        if (it == providers_.end()) {
            return std::nullopt;
        }
        
        return it->second->personal_sign(message);
    }
    
    // Sign typed data (EIP-712)
    std::optional<std::string> sign_typed_data(const std::string& data) {
        std::shared_lock lock(mutex_);
        
        auto it = providers_.find(current_chain_);
        if (it == providers_.end()) {
            return std::nullopt;
        }
        
        return it->second->signTypedData(data);
    }
    
    // Send transaction
    std::optional<std::string> send_transaction(const Transaction& tx) {
        std::shared_lock lock(mutex_);
        
        auto it = providers_.find(current_chain_);
        if (it == providers_.end()) {
            return std::nullopt;
        }
        
        return it->second->send_transaction(tx);
    }
    
    // Get balance
    std::optional<double> get_balance() {
        std::shared_lock lock(mutex_);
        
        auto it = providers_.find(current_chain_);
        if (it == providers_.end()) {
            return std::nullopt;
        }
        
        auto account = it->second->get_account();
        if (!account.has_value()) {
            return std::nullopt;
        }
        
        return it->second->get_balance(account.value());
    }
    
    // Get token balance
    std::optional<double> get_token_balance(const std::string& token_address) {
        std::shared_lock lock(mutex_);
        
        auto it = providers_.find(current_chain_);
        if (it == providers_.end()) {
            return std::nullopt;
        }
        
        auto account = it->second->get_account();
        if (!account.has_value()) {
            return std::nullopt;
        }
        
        return it->second->get_token_balance(account.value(), token_address);
    }
    
    // Get all token balances
    std::vector<Token> get_all_tokens() {
        std::vector<Token> tokens;
        
        std::shared_lock lock(mutex_);
        
        // Would query token balances from RPC
        // For now, return empty
        
        return tokens;
    }
    
    // Get all NFTs
    std::vector<NFT> get_all_nfts() {
        std::vector<NFT> nfts;
        
        std::shared_lock lock(mutex_);
        
        // Would query NFT balances
        // For now, return empty
        
        return nfts;
    }
    
    // Get transaction history
    std::vector<Transaction> get_transaction_history(uint32_t limit = 50) {
        std::shared_lock lock(mutex_);
        
        auto it = providers_.find(current_chain_);
        if (it == providers_.end()) {
            return {};
        }
        
        auto account = it->second->get_account();
        if (!account.has_value()) {
            return {};
        }
        
        auto txs = it->second->get_transactions(account.value(), limit);
        return txs.has_value() ? txs.value() : std::vector<Transaction>{};
    }
    
    // Estimate gas
    std::optional<uint64_t> estimate_gas(const Transaction& tx) {
        std::shared_lock lock(mutex_);
        
        // Would estimate gas using RPC
        return 21000;
    }
    
    // Get current chain
    ChainId get_current_chain() const {
        return current_chain_;
    }
    
    // Get supported chains
    std::vector<ChainId> get_supported_chains() const {
        std::vector<ChainId> chains;
        
        std::shared_lock lock(mutex_);
        
        for (const auto& [chain, provider] : providers_) {
            chains.push_back(chain);
        }
        
        return chains;
    }
    
    // Check if chain is supported
    bool is_chain_supported(ChainId chain) const {
        std::shared_lock lock(mutex_);
        return providers_.find(chain) != providers_.end();
    }
};

// Web3 Wallet Manager - main class
class Web3WalletManager {
private:
    std::unique_ptr<MultiChainWallet> wallet_;
    std::vector<Web3Provider*> active_providers_;
    
    // Session management
    struct Session {
        std::string id;
        std::string address;
        ChainId chain;
        WalletType type;
        uint64_t created_at;
        uint64_t last_active;
        bool is_active;
    };
    
    std::unordered_map<std::string, Session> sessions_;
    std::atomic<uint64_t> session_counter_{0};
    
    // Events
    std::vector<std::function<void(const Session&)>> on_session_start_;
    std::vector<std::function<void(const Session&)>> on_session_end_;
    
public:
    Web3WalletManager() {
        wallet_ = std::make_unique<MultiChainWallet>();
    }
    
    // Initialize with providers
    void initialize() {
        // Add Ethereum provider
        auto eth_provider = std::make_unique<EIP1193Provider>("MetaMask", "1.0.0");
        wallet_->add_provider(ChainId::ETHEREUM_MAINNET, std::move(eth_provider));
        
        // Add Polygon provider
        auto poly_provider = std::make_unique<EIP1193Provider>("MetaMask", "1.0.0");
        wallet_->add_provider(ChainId::POLYGON, std::move(poly_provider));
        
        // Add BSC provider
        auto bsc_provider = std::make_unique<EIP1193Provider>("MetaMask", "1.0.0");
        wallet_->add_provider(ChainId::BSC, std::move(bsc_provider));
        
        // Add Avalanche provider
        auto avax_provider = std::make_unique<EIP1193Provider>("MetaMask", "1.0.0");
        wallet_->add_provider(ChainId::AVALANCHE, std::move(avax_provider));
        
        // Add Arbitrum provider
        auto arb_provider = std::make_unique<EIP1193Provider>("MetaMask", "1.0.0");
        wallet_->add_provider(ChainId::ARBITRUM, std::move(arb_provider));
        
        // Add Optimism provider
        auto op_provider = std::make_unique<EIP1193Provider>("MetaMask", "1.0.0");
        wallet_->add_provider(ChainId::OPTIMISM, std::move(op_provider));
        
        // Add Base provider
        auto base_provider = std::make_unique<EIP1193Provider>("MetaMask", "1.0.0");
        wallet_->add_provider(ChainId::BASE, std::move(base_provider));
    }
    
    // Connect wallet
    std::optional<std::string> connect(WalletType type, ChainId chain = ChainId::ETHEREUM_MAINNET) {
        if (type == WalletType::METAMASK || type == WalletType::COINBASE_WALLET || 
            type == WalletType::TRUST_WALLET || type == WalletType::RAINBOW) {
            return wallet_->connect(chain);
        } else if (type == WalletType::WALLET_CONNECT) {
            auto wc_provider = std::make_unique<WalletConnectProvider>("YOUR_PROJECT_ID");
            wallet_->add_provider(chain, std::move(wc_provider));
            return wallet_->connect(chain);
        }
        
        return std::nullopt;
    }
    
    // Disconnect wallet
    bool disconnect(ChainId chain) {
        return wallet_->disconnect(chain);
    }
    
    // Get connected accounts
    std::vector<std::string> get_connected_accounts() const {
        return wallet_->get_supported_chains().size() > 0 ? 
            std::vector<std::string>{wallet_->get_current_account().value_or("")} : 
            std::vector<std::string>{};
    }
    
    // Switch chain
    bool switch_chain(ChainId chain) {
        return wallet_->switch_chain(chain);
    }
    
    // Sign message
    std::optional<std::string> sign(const std::string& message) {
        return wallet_->sign_message(message);
    }
    
    // Sign typed data (EIP-712)
    std::optional<std::string> sign_typed_data(const std::string& json_data) {
        return wallet_->sign_typed_data(json_data);
    }
    
    // Send transaction
    std::optional<std::string> send(const Transaction& tx) {
        return wallet_->send_transaction(tx);
    }
    
    // Get balance
    std::optional<double> get_balance() {
        return wallet_->get_balance();
    }
    
    // Get token balance
    std::optional<double> get_token_balance(const std::string& token) {
        return wallet_->get_token_balance(token);
    }
    
    // Get all tokens
    std::vector<Token> get_tokens() {
        return wallet_->get_all_tokens();
    }
    
    // Get all NFTs
    std::vector<NFT> get_nfts() {
        return wallet_->get_all_nfts();
    }
    
    // Get transaction history
    std::vector<Transaction> get_history(uint32_t limit = 50) {
        return wallet_->get_transaction_history(limit);
    }
    
    // Get current chain
    ChainId get_current_chain() const {
        return wallet_->get_current_chain();
    }
    
    // Check if connected
    bool is_connected() const {
        return wallet_->get_current_account().has_value();
    }
    
    // Get supported chains
    std::vector<ChainId> get_supported_chains() const {
        return wallet_->get_supported_chains();
    }
    
    // Create session
    std::string create_session(const std::string& address, WalletType type) {
        std::string session_id = "session_" + std::to_string(session_counter_.fetch_add(1));
        
        Session session;
        session.id = session_id;
        session.address = address;
        session.chain = wallet_->get_current_chain();
        session.type = type;
        session.created_at = std::chrono::system_clock::now().time_since_epoch().count();
        session.last_active = session.created_at;
        session.is_active = true;
        
        sessions_[session_id] = session;
        
        // Notify listeners
        for (auto& callback : on_session_start_) {
            callback(session);
        }
        
        return session_id;
    }
    
    // End session
    void end_session(const std::string& session_id) {
        auto it = sessions_.find(session_id);
        if (it == sessions_.end()) return;
        
        it->second.is_active = false;
        
        // Notify listeners
        for (auto& callback : on_session_end_) {
            callback(it->second);
        }
    }
    
    // Get active sessions
    std::vector<Session> get_active_sessions() {
        std::vector<Session> active;
        
        for (const auto& [id, session] : sessions_) {
            if (session.is_active) {
                active.push_back(session);
            }
        }
        
        return active;
    }
};

} // namespace web3
} // namespace tigerex

#endif // TIGEREX_WEB3_WALLET_HPP