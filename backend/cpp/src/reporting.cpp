/**
 * TigerEx Reporting Engine - C++
 * Trade reporting, analytics and compliance checks.
 *
 * Reports are produced from trades supplied on the command line as a CSV file
 * (one trade per line: trade_id,timestamp,symbol,side,price,quantity,fee,pnl).
 * Nothing is fabricated: with no readable input the program exits non-zero
 * rather than printing an illustrative report.
 */

#include <cmath>
#include <cstdint>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

struct TradeReport {
    uint64_t trade_id;
    uint64_t timestamp;
    std::string symbol;
    std::string side;
    double price;
    double quantity;
    double fee;
    double pnl;
};

namespace {

// Parse a full numeric field, rejecting trailing garbage that stod/stoull would
// otherwise ignore ("12abc" -> 12) and any non-finite value.
double parse_double(const std::string& field) {
    size_t consumed = 0;
    double value = std::stod(field, &consumed);
    if (consumed != field.size()) throw std::invalid_argument("trailing characters: " + field);
    if (!std::isfinite(value)) throw std::invalid_argument("non-finite value: " + field);
    return value;
}

uint64_t parse_uint(const std::string& field) {
    size_t consumed = 0;
    unsigned long long value = std::stoull(field, &consumed);
    if (consumed != field.size()) throw std::invalid_argument("trailing characters: " + field);
    return static_cast<uint64_t>(value);
}

}  // namespace

// ============================================================================
// REPORT GENERATOR
// ============================================================================

class ReportGenerator {
private:
    std::vector<TradeReport> trades;

public:
    void add_trade(const TradeReport& tr) { trades.push_back(tr); }

    size_t trade_count() const { return trades.size(); }

    // Total notional traded across all loaded trades.
    double total_volume() const {
        double volume = 0;
        for (const auto& tr : trades) volume += tr.price * tr.quantity;
        return volume;
    }

    std::string generate_daily_report() const {
        double total_volume = 0;
        double total_fees = 0;
        double total_pnl = 0;
        int buy_count = 0;
        int sell_count = 0;

        for (const auto& tr : trades) {
            total_volume += tr.price * tr.quantity;
            total_fees += tr.fee;
            total_pnl += tr.pnl;
            if (tr.side == "BUY") buy_count++;
            else sell_count++;
        }

        std::ostringstream oss;
        oss << "=== DAILY REPORT ===\n";
        oss << "Total Trades: " << trades.size() << "\n";
        oss << "Buy: " << buy_count << ", Sell: " << sell_count << "\n";
        oss << "Volume: $" << std::fixed << std::setprecision(2) << total_volume << "\n";
        oss << "Fees: $" << total_fees << "\n";
        oss << "PnL: $" << total_pnl << "\n";

        return oss.str();
    }

    // Only realized PnL is present in trade records; unrealized PnL needs live
    // positions, which this offline report does not have, so it is reported as
    // not applicable rather than as zero.
    std::string generate_tax_report() const {
        double realized_pnl = 0;
        double fees = 0;

        for (const auto& tr : trades) {
            realized_pnl += tr.pnl;
            fees += tr.fee;
        }

        std::ostringstream oss;
        oss << "=== TAX REPORT ===\n";
        oss << "Realized PnL: $" << std::fixed << std::setprecision(2) << realized_pnl << "\n";
        oss << "Unrealized PnL: n/a (no live positions in this report)\n";
        oss << "Fees (deductible): $" << fees << "\n";
        oss << "Taxable Income: $" << (realized_pnl + fees) << "\n";

        return oss.str();
    }

    std::string generate_audit_log() const {
        std::ostringstream oss;
        oss << "=== AUDIT LOG ===\n";

        for (const auto& tr : trades) {
            oss << "[" << tr.timestamp << "] " << tr.side << " " << tr.symbol << " @ $" << tr.price
                << " x " << tr.quantity << "\n";
        }

        return oss.str();
    }
};

// ============================================================================
// COMPLIANCE CHECKER
// ============================================================================

class ComplianceChecker {
public:
    struct Violation {
        std::string type;
        std::string description;
        uint64_t timestamp;
    };

    // Flags when the supplied daily volume exceeds the threshold. The volume is
    // measured from the caller's trades, never assumed to be zero.
    static std::vector<Violation> check_volume(double daily_volume, double threshold,
                                               uint64_t timestamp) {
        std::vector<Violation> violations;
        if (!std::isfinite(daily_volume) || !std::isfinite(threshold) || threshold < 0) {
            throw std::invalid_argument("volume and threshold must be finite and non-negative");
        }
        if (daily_volume > threshold) {
            std::ostringstream desc;
            desc << "Daily volume " << daily_volume << " exceeded threshold " << threshold;
            violations.push_back({"VOLUME_THRESHOLD", desc.str(), timestamp});
        }
        return violations;
    }
};

// ============================================================================
// INPUT
// ============================================================================

// Each non-empty, non-comment line is:
// trade_id,timestamp,symbol,side,price,quantity,fee,pnl
static bool load_trades(const std::string& path, ReportGenerator& rg) {
    std::ifstream file(path);
    if (!file.is_open()) {
        std::cerr << "Cannot open trade file: " << path << std::endl;
        return false;
    }

    std::string line;
    while (std::getline(file, line)) {
        if (line.empty() || line[0] == '#') continue;

        std::stringstream ss(line);
        std::string id_s, ts_s, symbol, side, price_s, qty_s, fee_s, pnl_s;
        if (!std::getline(ss, id_s, ',') || !std::getline(ss, ts_s, ',') ||
            !std::getline(ss, symbol, ',') || !std::getline(ss, side, ',') ||
            !std::getline(ss, price_s, ',') || !std::getline(ss, qty_s, ',') ||
            !std::getline(ss, fee_s, ',') || !std::getline(ss, pnl_s, ',')) {
            std::cerr << "Malformed trade line: " << line << std::endl;
            return false;
        }

        try {
            TradeReport tr{
                parse_uint(id_s), parse_uint(ts_s), symbol, side,
                parse_double(price_s), parse_double(qty_s),
                parse_double(fee_s), parse_double(pnl_s),
            };
            if (tr.symbol.empty() || (tr.side != "BUY" && tr.side != "SELL") || tr.price <= 0 ||
                tr.quantity <= 0 || tr.fee < 0) {
                std::cerr << "Out-of-range trade value in line: " << line << std::endl;
                return false;
            }
            rg.add_trade(tr);
        } catch (const std::exception&) {
            std::cerr << "Invalid trade value in line: " << line << std::endl;
            return false;
        }
    }

    if (rg.trade_count() == 0) {
        std::cerr << "Trade file contained no trades: " << path << std::endl;
        return false;
    }
    return true;
}

// ============================================================================
// MAIN
// ============================================================================

#ifndef TIGEREX_REPORTING_NO_MAIN
int main(int argc, char** argv) {
    if (argc < 2) {
        std::cerr << "usage: reporting <trades.csv> [volume-threshold]" << std::endl;
        return 1;
    }

    ReportGenerator rg;
    if (!load_trades(argv[1], rg)) {
        return 1;
    }

    std::cout << rg.generate_daily_report() << std::endl;
    std::cout << rg.generate_tax_report() << std::endl;

    if (argc >= 3) {
        double threshold = 0;
        try {
            threshold = parse_double(argv[2]);
        } catch (const std::exception&) {
            std::cerr << "Invalid threshold: " << argv[2] << std::endl;
            return 1;
        }
        auto violations = ComplianceChecker::check_volume(rg.total_volume(), threshold, 0);
        std::cout << "Compliance violations: " << violations.size() << std::endl;
        for (const auto& v : violations) {
            std::cout << "  " << v.type << ": " << v.description << std::endl;
        }
    }

    return 0;
}
#endif // TIGEREX_REPORTING_NO_MAIN
