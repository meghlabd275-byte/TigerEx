/**
 * TigerEx Premier Loans
 * Unsecured credit for verified users
 * 
 * Copyright (c) 2024 TigerEx
 */

#ifndef TIGEREX_PREMIER_LOANS_HPP
#define TIGEREX_PREMIER_LOANS_HPP

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
#include <algorithm>
#include <cmath>

namespace tigerex {
namespace loans {

enum class LoanStatus { PENDING = 0, ACTIVE = 1, REPAID = 2, DEFAULTED = 3, CANCELLED = 4 };
enum class LoanType { PERSONAL = 0, BUSINESS = 1, MARGIN = 2, INSTANT = 3 };
enum class RepaymentType { EMI = 0, BULLET = 1, FLEXIBLE = 2 };

struct LoanOffer {
    std::string offer_id;
    std::string user_id;
    LoanType type;
    double amount;
    double interest_rate;
    uint64_t term_days;
    double processing_fee;
    uint64_t valid_until;
    bool is_approved;
    LoanOffer() : type(LoanType::PERSONAL), amount(0), interest_rate(0), term_days(0), processing_fee(0), valid_until(0), is_approved(false) {}
};

struct Loan {
    std::string loan_id;
    std::string user_id;
    std::string offer_id;
    LoanType type;
    LoanStatus status;
    double principal;
    double interest_rate;
    uint64_t term_days;
    double emi_amount;
    double total_interest;
    double total_repayment;
    double paid_amount;
    double remaining_amount;
    uint64_t start_date;
    uint64_t next_payment_date;
    uint64_t end_date;
    double collateral_value;
    std::string collateral_type;
    Loan() : type(LoanType::PERSONAL), status(LoanStatus::PENDING), principal(0), interest_rate(0), term_days(0), emi_amount(0), total_interest(0), total_repayment(0), paid_amount(0), remaining_amount(0), start_date(0), next_payment_date(0), end_date(0), collateral_value(0) {}
};

struct CreditScore {
    std::string user_id;
    double score;  // 300-850
    std::string grade;  // A, B, C, D, E
    double income;
    double max_loan_amount;
    double interest_rate;
    uint64_t last_updated;
    CreditScore() : score(0), income(0), max_loan_amount(0), interest_rate(0), last_updated(0) {}
};

class PremierLoansEngine {
private:
    std::unordered_map<std::string, LoanOffer> offers_;
    std::unordered_map<std::string, Loan> loans_;
    std::unordered_map<std::string, CreditScore> credit_scores_;
    std::atomic<uint64_t> next_offer_id_{1};
    std::atomic<uint64_t> next_loan_id_{1};
    std::atomic<uint64_t> total_disbursed_{0};
    std::atomic<uint64_t> total_repaid_{0};
    mutable std::shared_mutex mutex_;

public:
    PremierLoansEngine() {}

    // Calculate credit score. A non-positive income yields no score, because the
    // debt-to-income ratio is undefined and the loan limit would be meaningless.
    std::optional<double> calculate_credit_score(const std::string& user_id, double income,
                                                 uint64_t credit_history_months,
                                                 double existing_debt) {
        if (!std::isfinite(income) || income <= 0.0) {
            return std::nullopt;
        }
        if (!std::isfinite(existing_debt) || existing_debt < 0.0) {
            return std::nullopt;
        }

        double base_score = 300.0;
        double income_factor = std::min(income / 100000.0, 200.0);
        double history_factor = std::min(static_cast<double>(credit_history_months) / 12.0 * 20.0, 200.0);
        double debt_ratio = existing_debt / income;
        double debt_factor = 100.0 - std::min(debt_ratio * 50.0, 100.0);

        double score = base_score + income_factor + history_factor + debt_factor;
        return std::min(std::max(score, 300.0), 850.0);
    }

    // Get credit grade
    std::string get_credit_grade(double score) {
        if (score >= 800) return "A+";
        if (score >= 750) return "A";
        if (score >= 700) return "B";
        if (score >= 650) return "C";
        if (score >= 600) return "D";
        return "E";
    }

    // Get interest rate from score
    double get_interest_rate(double score) {
        if (score >= 800) return 3.99;
        if (score >= 750) return 5.99;
        if (score >= 700) return 8.99;
        if (score >= 650) return 12.99;
        if (score >= 600) return 18.99;
        return 24.99;
    }

    // Get max loan amount
    double get_max_loan_amount(double score, double income) {
        double multiplier = (score >= 750) ? 10 : (score >= 700) ? 5 : (score >= 650) ? 3 : 1;
        return income * multiplier;
    }

    // Create loan offer. The rate and the size are drawn from the user's stored
    // credit assessment; a user without one has no offer. The offer is rejected
    // when it exceeds the assessed limit.
    std::optional<std::string> create_offer(const std::string& user_id, LoanType type,
                                            double amount, uint64_t term_days) {
        std::unique_lock lock(mutex_);

        if (!std::isfinite(amount) || amount <= 0.0 || term_days == 0) {
            return std::nullopt;
        }

        auto score_it = credit_scores_.find(user_id);
        if (score_it == credit_scores_.end()) {
            return std::nullopt;
        }
        const CreditScore& credit = score_it->second;

        if (amount > credit.max_loan_amount) {
            return std::nullopt;
        }

        double rate = get_interest_rate(credit.score);
        double processing_fee = amount * 0.01;

        std::string offer_id = "LOAN_" + std::to_string(next_offer_id_.fetch_add(1));

        LoanOffer offer;
        offer.offer_id = offer_id;
        offer.user_id = user_id;
        offer.type = type;
        offer.amount = amount;
        offer.interest_rate = rate;
        offer.term_days = term_days;
        offer.processing_fee = processing_fee;
        offer.valid_until = std::chrono::system_clock::now().time_since_epoch().count() +
                            (7LL * 24 * 60 * 60 * 1000000000LL);
        offer.is_approved = true;

        offers_[offer_id] = offer;
        return offer_id;
    }

    // Accept offer and create loan
    std::optional<std::string> accept_offer(const std::string& offer_id) {
        std::unique_lock lock(mutex_);

        auto offer_it = offers_.find(offer_id);
        if (offer_it == offers_.end()) return std::nullopt;

        const LoanOffer& offer = offer_it->second;

        if (!offer.is_approved) {
            return std::nullopt;
        }

        // An offer can only be accepted once.
        for (const auto& [id, loan] : loans_) {
            if (loan.offer_id == offer_id) {
                return std::nullopt;
            }
        }

        // Amortising payment over the term. A zero rate is a valid offer and must
        // not divide by zero.
        double monthly_rate = offer.interest_rate / 12.0 / 100.0;
        double months = static_cast<double>(offer.term_days) / 30.0;
        if (months <= 0.0) {
            return std::nullopt;
        }

        double emi;
        double total_interest;
        if (monthly_rate <= 0.0) {
            emi = offer.amount / months;
            total_interest = 0.0;
        } else {
            double growth = std::pow(1.0 + monthly_rate, months);
            emi = (offer.amount * monthly_rate * growth) / (growth - 1.0);
            total_interest = emi * months - offer.amount;
        }

        std::string loan_id = "LN_" + std::to_string(next_loan_id_.fetch_add(1));

        Loan loan;
        loan.loan_id = loan_id;
        loan.user_id = offer.user_id;
        loan.offer_id = offer_id;
        loan.type = offer.type;
        loan.status = LoanStatus::ACTIVE;
        loan.principal = offer.amount;
        loan.interest_rate = offer.interest_rate;
        loan.term_days = offer.term_days;
        loan.emi_amount = emi;
        loan.total_interest = total_interest;
        loan.total_repayment = offer.amount + total_interest;
        loan.remaining_amount = loan.total_repayment;
        loan.start_date = std::chrono::system_clock::now().time_since_epoch().count();
        loan.next_payment_date = loan.start_date + (30LL * 24 * 60 * 60 * 1000000000LL);
        loan.end_date = loan.start_date +
                        (static_cast<int64_t>(offer.term_days) * 24LL * 60 * 60 * 1000000000LL);

        loans_[loan_id] = loan;

        total_disbursed_.fetch_add(static_cast<uint64_t>(offer.amount));

        return loan_id;
    }

    // Make payment
    bool make_payment(const std::string& loan_id, double amount) {
        std::unique_lock lock(mutex_);

        if (!std::isfinite(amount) || amount <= 0.0) {
            return false;
        }

        auto it = loans_.find(loan_id);
        if (it == loans_.end()) return false;

        Loan& loan = it->second;
        if (loan.status != LoanStatus::ACTIVE) return false;

        // Overpayment is capped at what is still owed so the loan cannot be
        // credited more than its balance.
        double applied = std::min(amount, loan.remaining_amount);

        loan.paid_amount += applied;
        loan.remaining_amount -= applied;

        if (loan.remaining_amount <= 0.0) {
            loan.status = LoanStatus::REPAID;
            loan.remaining_amount = 0.0;
            loan.next_payment_date = 0;
        } else {
            uint64_t next = loan.next_payment_date + (30LL * 24 * 60 * 60 * 1000000000LL);
            loan.next_payment_date = std::min(next, loan.end_date);
        }

        total_repaid_.fetch_add(static_cast<uint64_t>(applied));
        return true;
    }

    // Get loan
    std::optional<Loan> get_loan(const std::string& loan_id) const {
        std::shared_lock lock(mutex_);
        auto it = loans_.find(loan_id);
        if (it != loans_.end()) return it->second;
        return std::nullopt;
    }

    // Get user loans
    std::vector<Loan> get_user_loans(const std::string& user_id) const {
        std::shared_lock lock(mutex_);
        std::vector<Loan> result;
        for (const auto& [id, loan] : loans_) {
            if (loan.user_id == user_id) result.push_back(loan);
        }
        return result;
    }

    // Get credit score
    std::optional<CreditScore> get_credit_score(const std::string& user_id) const {
        std::shared_lock lock(mutex_);
        auto it = credit_scores_.find(user_id);
        if (it != credit_scores_.end()) return it->second;
        return std::nullopt;
    }

    // Update credit score. Returns false when the inputs cannot produce a score.
    bool update_credit_score(const std::string& user_id, double income, uint64_t months, double debt) {
        auto score = calculate_credit_score(user_id, income, months, debt);
        if (!score.has_value()) {
            return false;
        }

        std::unique_lock lock(mutex_);

        CreditScore cs;
        cs.user_id = user_id;
        cs.score = *score;
        cs.grade = get_credit_grade(cs.score);
        cs.income = income;
        cs.max_loan_amount = get_max_loan_amount(cs.score, income);
        cs.interest_rate = get_interest_rate(cs.score);
        cs.last_updated = std::chrono::system_clock::now().time_since_epoch().count();

        credit_scores_[user_id] = cs;
        return true;
    }

    // Get statistics
    uint64_t get_total_disbursed() const { return total_disbursed_.load(); }
    uint64_t get_total_repaid() const { return total_repaid_.load(); }
    uint64_t get_active_loans_count() const {
        uint64_t count = 0;
        for (const auto& [id, loan] : loans_) {
            if (loan.status == LoanStatus::ACTIVE) count++;
        }
        return count;
    }
};

} // namespace loans
} // namespace tigerex

#endif // TIGEREX_PREMIER_LOANS_HPP