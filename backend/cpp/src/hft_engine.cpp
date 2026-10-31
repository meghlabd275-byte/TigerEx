// TigerEx low-latency engine driver.
//
// Reads newline-delimited JSON commands from stdin and writes one JSON result
// per line to stdout. The matching itself lives in include/hft_low_latency.hpp;
// this file is only the process boundary, so the engine stays testable without
// a network stack.
//
// Commands:
//   {"cmd":"submit","symbol":"BTC/RUSD","id":1,"user":1,"side":"buy",
//    "type":"limit","tif":"gtc","price":50000,"quantity":10}
//   {"cmd":"cancel","symbol":"BTC/RUSD","id":1}
//   {"cmd":"depth","symbol":"BTC/RUSD","levels":10}
//   {"cmd":"stats"}
#include "hft_low_latency.hpp"

#include <cstdio>
#include <iostream>
#include <sstream>
#include <string>

namespace {

using namespace tigerex::hft;

// Minimal extraction helpers for a flat command line. They do not parse nested
// objects; an unexpected shape yields the default rather than a wrong value.
std::string json_string(const std::string& line, const std::string& key) {
    const std::string needle = "\"" + key + "\"";
    auto pos = line.find(needle);
    if (pos == std::string::npos) return {};
    pos = line.find(':', pos + needle.size());
    if (pos == std::string::npos) return {};
    auto q1 = line.find('"', pos + 1);
    if (q1 == std::string::npos) return {};
    auto q2 = line.find('"', q1 + 1);
    if (q2 == std::string::npos) return {};
    return line.substr(q1 + 1, q2 - q1 - 1);
}

long long json_number(const std::string& line, const std::string& key, long long fallback = 0) {
    const std::string needle = "\"" + key + "\"";
    auto pos = line.find(needle);
    if (pos == std::string::npos) return fallback;
    pos = line.find(':', pos + needle.size());
    if (pos == std::string::npos) return fallback;
    ++pos;
    while (pos < line.size() && (line[pos] == ' ' || line[pos] == '\t')) ++pos;
    bool negative = false;
    if (pos < line.size() && line[pos] == '-') {
        negative = true;
        ++pos;
    }
    long long value = 0;
    bool any = false;
    while (pos < line.size() && line[pos] >= '0' && line[pos] <= '9') {
        value = value * 10 + (line[pos] - '0');
        any = true;
        ++pos;
    }
    if (!any) return fallback;
    return negative ? -value : value;
}

Side parse_side(const std::string& value) {
    return value == "sell" ? Side::Sell : Side::Buy;
}

OrderType parse_type(const std::string& value) {
    return value == "market" ? OrderType::Market : OrderType::Limit;
}

TimeInForce parse_tif(const std::string& value) {
    if (value == "ioc") return TimeInForce::IOC;
    if (value == "fok") return TimeInForce::FOK;
    return TimeInForce::GTC;
}

const char* status_name(Status status) {
    switch (status) {
        case Status::New: return "new";
        case Status::PartiallyFilled: return "partially_filled";
        case Status::Filled: return "filled";
        case Status::Cancelled: return "cancelled";
        case Status::Rejected: return "rejected";
    }
    return "rejected";
}

}  // namespace

int main() {
    MatchingEngine engine;
    std::string line;
    while (std::getline(std::cin, line)) {
        if (line.empty()) continue;

        const std::string cmd = json_string(line, "cmd");

        if (cmd == "submit") {
            Order order{};
            order.id = static_cast<OrderId>(json_number(line, "id"));
            order.user = static_cast<UserId>(json_number(line, "user"));
            order.side = parse_side(json_string(line, "side"));
            order.type = parse_type(json_string(line, "type"));
            order.tif = parse_tif(json_string(line, "tif"));
            order.price = static_cast<Price>(json_number(line, "price"));
            order.quantity = static_cast<Quantity>(json_number(line, "quantity"));

            const std::string symbol = json_string(line, "symbol");
            if (symbol.empty() || order.id == 0 || order.quantity <= 0) {
                std::printf("{\"ok\":false,\"error\":\"symbol, id and a positive quantity are required\"}\n");
                std::fflush(stdout);
                continue;
            }

            SubmitResult r = engine.submit(symbol, order);
            std::ostringstream out;
            out << "{\"ok\":true,\"status\":\"" << status_name(r.status)
                << "\",\"filled\":" << r.filled << ",\"trades\":[";
            for (std::size_t i = 0; i < r.trades.size(); ++i) {
                const Trade& t = r.trades[i];
                if (i) out << ',';
                out << "{\"taker\":" << t.taker << ",\"maker\":" << t.maker
                    << ",\"price\":" << t.price << ",\"quantity\":" << t.quantity << '}';
            }
            out << "]}";
            std::printf("%s\n", out.str().c_str());
            std::fflush(stdout);
        } else if (cmd == "cancel") {
            const std::string symbol = json_string(line, "symbol");
            const auto id = static_cast<OrderId>(json_number(line, "id"));
            const bool removed = !symbol.empty() && engine.cancel(symbol, id);
            std::printf("{\"ok\":true,\"cancelled\":%s}\n", removed ? "true" : "false");
            std::fflush(stdout);
        } else if (cmd == "depth") {
            const std::string symbol = json_string(line, "symbol");
            auto levels = static_cast<std::size_t>(json_number(line, "levels", 10));
            if (levels == 0) levels = 10;
            auto [bids, asks] = engine.book(symbol).depth(levels);
            std::ostringstream out;
            out << "{\"ok\":true,\"symbol\":\"" << symbol << "\",\"bids\":[";
            for (std::size_t i = 0; i < bids.size(); ++i) {
                if (i) out << ',';
                out << '[' << bids[i].first << ',' << bids[i].second << ']';
            }
            out << "],\"asks\":[";
            for (std::size_t i = 0; i < asks.size(); ++i) {
                if (i) out << ',';
                out << '[' << asks[i].first << ',' << asks[i].second << ']';
            }
            out << "]}";
            std::printf("%s\n", out.str().c_str());
            std::fflush(stdout);
        } else if (cmd == "stats") {
            std::printf(
                "{\"ok\":true,\"orders\":%llu,\"trades\":%llu,\"rejected\":%llu,"
                "\"cancelled\":%llu,\"volume\":%lld}\n",
                static_cast<unsigned long long>(engine.orders()),
                static_cast<unsigned long long>(engine.trades()),
                static_cast<unsigned long long>(engine.rejected()),
                static_cast<unsigned long long>(engine.cancelled()),
                static_cast<long long>(engine.volume()));
            std::fflush(stdout);
        } else {
            std::printf("{\"ok\":false,\"error\":\"unknown command\"}\n");
            std::fflush(stdout);
        }
    }
    return 0;
}
