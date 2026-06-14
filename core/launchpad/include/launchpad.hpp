/**
 * TigerEx Token Launchpad
 * Professional token launch platform with fair distribution
 * ICO, IEO, IDO, Fair Launch support
 * 
 * Copyright (c) 2024 TigerEx
 * Licensed under MIT License
 */

#ifndef TIGEREX_LAUNCHPAD_HPP
#define TIGEREX_LAUNCHPAD_HPP

#include <vector>
#include <map>
#include <unordered_map>
#include <optional>
#include <memory>
#include <mutex>
#include <shared_mutex>
#include <atomic>
#include <chrono>
#include <string>

namespace tigerex {
namespace launchpad {

enum class LaunchType : uint8_t { ICO = 0, IEO = 1, IDO = 2, FAIR_LAUNCH = 3, SEED = 4, PRIVATE = 5, PUBLIC = 6 };
enum class LaunchStatus : uint8_t { PENDING = 0, UPCOMING = 1, ACTIVE = 2, ENDED = 3, CANCELLED = 4, FILLED = 5 };

struct LaunchToken {
    std::string address;
    std::string name;
    std::string symbol;
    uint8_t decimals;
    uint64_t total_supply;
    uint64_t circulating_supply;
    LaunchToken() : decimals(18), total_supply(0), circulating_supply(0) {}
};

struct LaunchProject {
    std::string project_id;
    std::string name;
    std::string description;
    std::string logo_url;
    std::string website;
    LaunchToken token;
    LaunchType launch_type;
    LaunchStatus status;
    uint64_t soft_cap;
    uint64_t hard_cap;
    uint64_t raised_amount;
    uint64_t min_contribution;
    uint64_t max_contribution;
    double token_price;
    std::string payment_token;
    uint64_t start_time;
    uint64_t end_time;
    uint64_t participants_count;
    uint64_t created_at;
    uint64_t team_allocation;
    uint64_t marketing_allocation;
    uint64_t liquidity_allocation;
    double vesting_percentage;
    uint64_t vesting_cliff;
    uint64_t vesting_duration;
    LaunchProject() : launch_type(LaunchType::ICO), status(LaunchStatus::PENDING), soft_cap(0), hard_cap(0), raised_amount(0), min_contribution(0), max_contribution(0), token_price(0), start_time(0), end_time(0), participants_count(0), created_at(0), team_allocation(0), marketing_allocation(0), liquidity_allocation(0), vesting_percentage(0), vesting_cliff(0), vesting_duration(0) {}
};

struct Participation {
    std::string participation_id;
    std::string project_id;
    std::string user_id;
    uint64_t contributed_amount;
    uint64_t received_tokens;
    uint64_t claimed_tokens;
    uint64_t vested_tokens;
    bool is_refunded;
    uint64_t refund_amount;
    uint64_t timestamp;
    Participation() : contributed_amount(0), received_tokens(0), claimed_tokens(0), vested_tokens(0), is_refunded(false), refund_amount(0), timestamp(0) {}
};

class LaunchpadEngine {
private:
    std::unordered_map<std::string, LaunchProject> projects_;
    std::unordered_map<std::string, std::vector<Participation>> participations_;
    std::atomic<uint64_t> next_project_id_{1};
    std::atomic<uint64_t> total_raised_{0};
    std::atomic<uint64_t> total_participants_{0};
    mutable std::shared_mutex mutex_;

public:
    std::string create_project(
        const std::string& name,
        const std::string& description,
        const LaunchToken& token,
        LaunchType launch_type,
        uint64_t soft_cap,
        uint64_t hard_cap,
        double token_price,
        const std::string& payment_token,
        uint64_t start_time,
        uint64_t end_time,
        uint64_t min_contribution,
        uint64_t max_contribution
    ) {
        std::unique_lock lock(mutex_);
        std::string project_id = "LAUNCH_" + std::to_string(next_project_id_.fetch_add(1));
        
        LaunchProject project;
        project.project_id = project_id;
        project.name = name;
        project.description = description;
        project.token = token;
        project.launch_type = launch_type;
        project.status = LaunchStatus::UPCOMING;
        project.soft_cap = soft_cap;
        project.hard_cap = hard_cap;
        project.token_price = token_price;
        project.payment_token = payment_token;
        project.start_time = start_time;
        project.end_time = end_time;
        project.min_contribution = min_contribution;
        project.max_contribution = max_contribution;
        project.created_at = std::chrono::system_clock::now().time_since_epoch().count();
        
        projects_[project_id] = project;
        return project_id;
    }
    
    std::optional<std::string> participate(
        const std::string& project_id,
        const std::string& user_id,
        uint64_t amount
    ) {
        std::unique_lock lock(mutex_);
        
        auto it = projects_.find(project_id);
        if (it == projects_.end()) return std::nullopt;
        
        LaunchProject& project = it->second;
        if (project.status != LaunchStatus::ACTIVE) return std::nullopt;
        if (amount < project.min_contribution || amount > project.max_contribution) return std::nullopt;
        
        if (project.raised_amount + amount > project.hard_cap) {
            amount = project.hard_cap - project.raised_amount;
        }
        
        uint64_t tokens_received = static_cast<uint64_t>(amount / project.token_price);
        
        Participation p;
        p.project_id = project_id;
        p.user_id = user_id;
        p.contributed_amount = amount;
        p.received_tokens = tokens_received;
        p.claimed_tokens = tokens_received;
        p.timestamp = std::chrono::system_clock::now().time_since_epoch().count();
        
        project.raised_amount += amount;
        project.participants_count++;
        
        if (project.raised_amount >= project.hard_cap) {
            project.status = LaunchStatus::FILLED;
        }
        
        total_raised_.fetch_add(amount);
        total_participants_.fetch_add(1);
        participations_[user_id].push_back(p);
        
        return project_id + "_" + std::to_string(participations_[user_id].size());
    }
    
    std::optional<LaunchProject> get_project(const std::string& project_id) const {
        std::shared_lock lock(mutex_);
        auto it = projects_.find(project_id);
        if (it != projects_.end()) return it->second;
        return std::nullopt;
    }
    
    std::vector<LaunchProject> get_active_projects() const {
        std::shared_lock lock(mutex_);
        std::vector<LaunchProject> result;
        uint64_t now = std::chrono::system_clock::now().time_since_epoch().count();
        for (const auto& [id, project] : projects_) {
            if (project.status == LaunchStatus::ACTIVE || 
                (project.status == LaunchStatus::UPCOMING && project.start_time > now)) {
                result.push_back(project);
            }
        }
        return result;
    }
    
    std::vector<Participation> get_user_participations(const std::string& user_id) const {
        std::shared_lock lock(mutex_);
        auto it = participations_.find(user_id);
        if (it != participations_.end()) return it->second;
        return {};
    }
    
    uint64_t get_total_raised() const { return total_raised_.load(); }
    uint64_t get_total_participants() const { return total_participants_.load(); }
};

} // namespace launchpad
} // namespace tigerex

#endif // TIGEREX_LAUNCHPAD_HPP