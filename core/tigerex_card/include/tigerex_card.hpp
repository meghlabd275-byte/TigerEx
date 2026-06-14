/**
 * TigerEx Crypto Card Platform
 * Payment card with crypto rewards and fiat conversion
 * 
 * Copyright (c) 2024 TigerEx
 * Licensed under MIT License
 */

#ifndef TIGEREX_CRYPTO_CARD_HPP
#define TIGEREX_CRYPTO_CARD_HPP

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
#include <queue>

namespace tigerex {
namespace card {

// Card type
enum class CardType : uint8_t {
    VIRTUAL = 0,
    PHYSICAL = 1,
    METAL = 2,
    PREMIUM = 3,
    INFINITE = 4
};

// Card tier
enum class CardTier : uint8_t {
    STANDARD = 0,
    GOLD = 1,
    PLATINUM = 2,
    BLACK = 3,
    INFINITE = 4
};

// Card status
enum class CardStatus : uint8_t {
    PENDING = 0,
    ACTIVE = 1,
    FROZEN = 2,
    CANCELLED = 3,
    EXPIRED = 4,
    LOST = 5,
    STOLEN = 6
};

// Card network
enum class CardNetwork : uint8_t {
    VISA = 0,
    MASTERCARD = 1,
    AMEX = 2,
    UNIONPAY = 3
};

// Transaction type
enum class TransactionType : uint8_t {
    PURCHASE = 0,
    ATM_WITHDRAWAL = 1,
    REFUND = 2,
    FEE = 3,
    LOAD = 4,
    TRANSFER = 5,
    CRYPTO_REWARD = 6,
    CASHBACK = 7
};

// Transaction status
enum class TransactionStatus : uint8_t {
    PENDING = 0,
    COMPLETED = 1,
    FAILED = 2,
    CANCELLED = 3,
    BLOCKED = 4
};

// Card information
struct Card {
    std::string card_id;
    std::string user_id;
    std::string masked_number;
    std::string cvv_hash;
    
    CardType type;
    CardTier tier;
    CardNetwork network;
    CardStatus status;
    
    std::string holder_name;
    uint32_t expiry_month;
    uint32_t expiry_year;
    
    uint64_t created_at;
    uint64_t activated_at;
    uint64_t expires_at;
    
    double spending_limit;
    double daily_limit;
    double monthly_limit;
    double atm_limit;
    
    double current_balance;
    double available_balance;
    
    bool is_virtual;
    bool is_locked;
    bool contactless_enabled;
    bool online_enabled;
    bool international_enabled;
    
    Card()
        : type(CardType::VIRTUAL)
        , tier(CardTier::STANDARD)
        , network(CardNetwork::VISA)
        , status(CardStatus::PENDING)
        , expiry_month(0)
        , expiry_year(0)
        , created_at(0)
        , activated_at(0)
        , expires_at(0)
        , spending_limit(0)
        , daily_limit(0)
        , monthly_limit(0)
        , atm_limit(0)
        , current_balance(0)
        , available_balance(0)
        , is_virtual(true)
        , is_locked(false)
        , contactless_enabled(true)
        , online_enabled(true)
        , international_enabled(false)
    {}
};

// Card transaction
struct CardTransaction {
    std::string transaction_id;
    std::string card_id;
    
    TransactionType type;
    TransactionStatus status;
    
    double amount;
    double amount_usd;
    double fee;
    double cashback;
    double crypto_reward;
    
    std::string currency;
    std::string merchant_name;
    std::string merchant_category;
    std::string merchant_country;
    
    std::string token;
    std::string authorization_code;
    
    double exchange_rate;
    double fx_fee;
    
    double latitude;
    double longitude;
    
    std::string device_fingerprint;
    std::string ip_address;
    
    uint64_t timestamp;
    uint64_t completed_at;
    
    CardTransaction()
        : type(TransactionType::PURCHASE)
        , status(TransactionStatus::PENDING)
        , amount(0)
        , amount_usd(0)
        , fee(0)
        , cashback(0)
        , crypto_reward(0)
        , exchange_rate(1.0)
        , fx_fee(0)
        , latitude(0)
        , longitude(0)
        , timestamp(0)
        , completed_at(0)
    {}
};

// Cashback reward
struct CashbackReward {
    std::string reward_id;
    std::string card_id;
    std::string merchant_category;
    double cashback_rate;
    double max_cashback;
    double min_purchase;
    bool is_active;
    uint64_t starts_at;
    uint64_t expires_at;
    
    CashbackReward()
        : cashback_rate(0), max_cashback(0), min_purchase(0), is_active(true), starts_at(0), expires_at(0) {}
};

// Crypto reward
struct CryptoReward {
    std::string reward_id;
    std::string card_id;
    std::string token_symbol;
    double reward_rate;
    double tier_multiplier;
    bool is_active;
    uint64_t starts_at;
    uint64_t expires_at;
    
    CryptoReward()
        : reward_rate(0), tier_multiplier(1.0), is_active(true), starts_at(0), expires_at(0) {}
};

// Card application
struct CardApplication {
    std::string application_id;
    std::string user_id;
    CardType type;
    CardTier tier;
    CardNetwork network;
    std::string shipping_address;
    std::string shipping_city;
    std::string shipping_state;
    std::string shipping_country;
    std::string shipping_zip;
    std::string id_document_type;
    std::string id_document_number;
    std::string kyc_level;
    uint64_t created_at;
    uint64_t approved_at;
    uint64_t shipped_at;
    bool approved;
    bool shipped;
    
    CardApplication()
        : type(CardType::VIRTUAL), tier(CardTier::STANDARD), network(CardNetwork::VISA), created_at(0), approved_at(0), shipped_at(0), approved(false), shipped(false) {}
};

// Risk assessment
struct RiskAssessment {
    double risk_score;
    bool approved;
    std::string reason;
    std::vector<std::string> flags;
    
    RiskAssessment() : risk_score(0), approved(true) {}
};

// Card security manager
class CardSecurityManager {
private:
    std::unordered_map<std::string, std::vector<std::string>> blocked_merchants_;
    std::unordered_map<std::string, std::vector<std::string>> blocked_countries_;
    std::unordered_map<std::string, std::vector<std::string>> blocked_ips_;
    std::vector<std::string> high_risk_mcc_;
    double max_velocity_;
    
public:
    CardSecurityManager() : max_velocity_(5.0) {
        high_risk_mcc_ = {"5999", "6012", "6211", "7299", "7999", "8999"};
    }
    
    RiskAssessment assess_transaction(const CardTransaction& tx, const Card& card) {
        RiskAssessment assessment;
        assessment.risk_score = 0.0;
        assessment.approved = true;
        
        double amount_score = tx.amount / card.daily_limit;
        if (amount_score > 0.5) {
            assessment.risk_score += 0.3;
            assessment.flags.push_back("High amount velocity");
        }
        
        if (std::find(high_risk_mcc_.begin(), high_risk_mcc_.end(), tx.merchant_category) != high_risk_mcc_.end()) {
            assessment.risk_score += 0.2;
            assessment.flags.push_back("High-risk merchant");
        }
        
        if (blocked_ips_.find(tx.ip_address) != blocked_ips_.end()) {
            assessment.risk_score += 0.5;
            assessment.flags.push_back("Blocked IP");
        }
        
        if (tx.device_fingerprint.empty()) {
            assessment.risk_score += 0.1;
            assessment.flags.push_back("Missing device fingerprint");
        }
        
        if (assessment.risk_score > 0.7) {
            assessment.approved = false;
            assessment.reason = "High risk score";
        } else if (assessment.risk_score > 0.4) {
            assessment.approved = true;
            assessment.reason = "Requires additional verification";
        }
        
        return assessment;
    }
};

// Card manager
class CardManager {
private:
    std::unordered_map<std::string, Card> cards_;
    std::unordered_map<std::string, std::vector<CardTransaction>> transactions_;
    std::unordered_map<std::string, CardApplication> applications_;
    std::atomic<uint64_t> next_card_id_{1};
    std::atomic<uint64_t> next_tx_id_{1};
    std::unique_ptr<CardSecurityManager> security_manager_;
    mutable std::shared_mutex mutex_;
    std::unordered_map<std::string, std::vector<CashbackReward>> cashback_rewards_;
    std::unordered_map<std::string, std::vector<CryptoReward>> crypto_rewards_;
    
    struct TierLimits {
        double daily_limit;
        double monthly_limit;
        double atm_limit;
        double spending_limit;
    };
    
    std::map<CardTier, TierLimits> tier_limits_ = {
        {CardTier::STANDARD, {1000, 10000, 500, 0}},
        {CardTier::GOLD, {5000, 50000, 2000, 0}},
        {CardTier::PLATINUM, {20000, 100000, 5000, 0}},
        {CardTier::BLACK, {50000, 250000, 10000, 0}},
        {CardTier::INFINITE, {0, 0, 20000, 0}}
    };
    
public:
    CardManager() {
        security_manager_ = std::make_unique<CardSecurityManager>();
    }
    
    std::string apply_for_card(const CardApplication& application) {
        std::unique_lock lock(mutex_);
        std::string application_id = "APP_" + std::to_string(next_card_id_.fetch_add(1));
        
        CardApplication new_app = application;
        new_app.application_id = application_id;
        new_app.created_at = std::chrono::system_clock::now().time_since_epoch().count();
        
        if (new_app.kyc_level == "FULL") {
            new_app.approved = true;
            new_app.approved_at = new_app.created_at;
        }
        
        applications_[application_id] = new_app;
        return application_id;
    }
    
    std::optional<std::string> issue_card(const std::string& application_id, CardType type) {
        std::unique_lock lock(mutex_);
        
        auto it = applications_.find(application_id);
        if (it == applications_.end()) return std::nullopt;
        if (!it->second.approved) return std::nullopt;
        
        std::string card_id = "CARD_" + std::to_string(next_card_id_.fetch_add(1));
        
        Card card;
        card.card_id = card_id;
        card.user_id = it->second.user_id;
        card.type = type;
        card.tier = it->second.tier;
        card.network = it->second.network;
        card.status = CardStatus::ACTIVE;
        card.holder_name = "TigerEx User";
        card.expiry_month = 12;
        card.expiry_year = 2028;
        card.created_at = std::chrono::system_clock::now().time_since_epoch().count();
        card.expires_at = card.created_at + 365 * 24 * 60 * 60 * 1000;
        
        auto limit_it = tier_limits_.find(card.tier);
        if (limit_it != tier_limits_.end()) {
            card.daily_limit = limit_it->second.daily_limit;
            card.monthly_limit = limit_it->second.monthly_limit;
            card.atm_limit = limit_it->second.atm_limit;
            card.spending_limit = limit_it->second.spending_limit;
        }
        
        cards_[card_id] = card;
        return card_id;
    }
    
    bool activate_card(const std::string& card_id) {
        std::unique_lock lock(mutex_);
        auto it = cards_.find(card_id);
        if (it == cards_.end()) return false;
        if (it->second.status != CardStatus::PENDING) return false;
        
        it->second.status = CardStatus::ACTIVE;
        it->second.activated_at = std::chrono::system_clock::now().time_since_epoch().count();
        return true;
    }
    
    bool freeze_card(const std::string& card_id) {
        std::unique_lock lock(mutex_);
        auto it = cards_.find(card_id);
        if (it == cards_.end()) return false;
        it->second.status = CardStatus::FROZEN;
        return true;
    }
    
    bool unfreeze_card(const std::string& card_id) {
        std::unique_lock lock(mutex_);
        auto it = cards_.find(card_id);
        if (it == cards_.end()) return false;
        it->second.status = CardStatus::ACTIVE;
        return true;
    }
    
    std::optional<std::string> process_transaction(const CardTransaction& tx) {
        std::unique_lock lock(mutex_);
        
        auto it = cards_.find(tx.card_id);
        if (it == cards_.end()) return std::nullopt;
        
        Card& card = it->second;
        if (card.status != CardStatus::ACTIVE) return std::nullopt;
        if (card.is_locked) return std::nullopt;
        if (tx.amount > card.available_balance) return std::nullopt;
        if (tx.amount > card.daily_limit) return std::nullopt;
        
        auto risk = security_manager_->assess_transaction(tx, card);
        if (!risk.approved) return std::nullopt;
        
        CardTransaction new_tx = tx;
        new_tx.transaction_id = "TX_" + std::to_string(next_tx_id_.fetch_add(1));
        new_tx.timestamp = std::chrono::system_clock::now().time_since_epoch().count();
        new_tx.status = TransactionStatus::COMPLETED;
        new_tx.completed_at = new_tx.timestamp;
        
        card.available_balance -= tx.amount;
        card.current_balance -= tx.amount;
        
        transactions_[tx.card_id].push_back(new_tx);
        return new_tx.transaction_id;
    }
    
    std::optional<Card> get_card(const std::string& card_id) const {
        std::shared_lock lock(mutex_);
        auto it = cards_.find(card_id);
        if (it != cards_.end()) return it->second;
        return std::nullopt;
    }
    
    std::vector<Card> get_user_cards(const std::string& user_id) const {
        std::shared_lock lock(mutex_);
        std::vector<Card> result;
        for (const auto& [id, card] : cards_) {
            if (card.user_id == user_id) result.push_back(card);
        }
        return result;
    }
    
    std::vector<CardTransaction> get_transactions(const std::string& card_id, uint32_t limit = 50) const {
        std::shared_lock lock(mutex_);
        auto it = transactions_.find(card_id);
        if (it == transactions_.end()) return {};
        
        auto& txs = it->second;
        if (txs.size() <= limit) return txs;
        return std::vector<CardTransaction>(txs.end() - limit, txs.end());
    }
    
    bool load_funds(const std::string& card_id, double amount) {
        std::unique_lock lock(mutex_);
        auto it = cards_.find(card_id);
        if (it == cards_.end()) return false;
        it->second.current_balance += amount;
        it->second.available_balance += amount;
        return true;
    }
};

// Crypto Card Platform - main class
class CryptoCardPlatform {
private:
    std::unique_ptr<CardManager> card_manager_;
    std::unordered_map<std::string, double> token_prices_;
    
public:
    CryptoCardPlatform() {
        card_manager_ = std::make_unique<CardManager>();
        token_prices_ = {{"BTC", 50000.0}, {"ETH", 3000.0}, {"USDT", 1.0}, {"USDC", 1.0}, {"BNB", 400.0}};
    }
    
    std::string apply(const CardApplication& app) {
        return card_manager_->apply_for_card(app);
    }
    
    std::optional<std::string> issue_virtual(const std::string& application_id) {
        return card_manager_->issue_card(application_id, CardType::VIRTUAL);
    }
    
    std::optional<std::string> issue_physical(const std::string& application_id) {
        return card_manager_->issue_card(application_id, CardType::PHYSICAL);
    }
    
    bool activate(const std::string& card_id) {
        return card_manager_->activate_card(card_id);
    }
    
    bool freeze(const std::string& card_id) {
        return card_manager_->freeze_card(card_id);
    }
    
    std::optional<std::string> process_payment(const CardTransaction& tx) {
        return card_manager_->process_transaction(tx);
    }
    
    std::optional<Card> get_card(const std::string& card_id) const {
        return card_manager_->get_card(card_id);
    }
    
    std::vector<Card> get_user_cards(const std::string& user_id) const {
        return card_manager_->get_user_cards(user_id);
    }
    
    std::vector<CardTransaction> get_transactions(const std::string& card_id, uint32_t limit = 50) const {
        return card_manager_->get_transactions(card_id, limit);
    }
    
    bool load_fiat(const std::string& card_id, double amount) {
        return card_manager_->load_funds(card_id, amount);
    }
    
    bool load_crypto(const std::string& card_id, const std::string& symbol, double amount) {
        auto price_it = token_prices_.find(symbol);
        if (price_it == token_prices_.end()) return false;
        double usd_value = amount * price_it->second;
        return card_manager_->load_funds(card_id, usd_value);
    }
    
    double get_crypto_balance(const std::string& card_id, const std::string& symbol) {
        auto price_it = token_prices_.find(symbol);
        if (price_it == token_prices_.end()) return 0;
        auto card_opt = card_manager_->get_card(card_id);
        if (!card_opt.has_value()) return 0;
        return card_opt->value().current_balance / price_it->second;
    }
    
    double get_total_cashback(const std::string& card_id) const {
        double total = 0;
        auto txs = card_manager_->get_transactions(card_id, 1000);
        for (const auto& tx : txs) total += tx.cashback;
        return total;
    }
    
    double get_total_crypto_rewards(const std::string& card_id) const {
        double total = 0;
        auto txs = card_manager_->get_transactions(card_id, 1000);
        for (const auto& tx : txs) total += tx.crypto_reward;
        return total;
    }
};

} // namespace card
} // namespace tigerex

#endif // TIGEREX_CRYPTO_CARD_HPP