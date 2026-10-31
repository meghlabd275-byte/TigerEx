/**
 * TigerEx market-data and configuration sources.
 *
 * Every value produced here comes from a live source (an exchange-independent
 * price aggregator, an EVM node, or an operator-supplied configuration file).
 * Nothing is invented: an unreachable or malformed source raises, and a symbol
 * with no source has no price.
 */
#ifndef TIGEREX_MARKET_DATA_HPP
#define TIGEREX_MARKET_DATA_HPP

#include <curl/curl.h>
#include <nlohmann/json.hpp>

#include <chrono>
#include <cstdlib>
#include <fstream>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <unordered_map>

namespace tigerex {
namespace market_data {

/// Perform a blocking HTTP request and return the response body.
/// Throws std::runtime_error on transport failure or a non-2xx status.
inline std::string http_request(const std::string& url,
                                const std::string& post_body = {},
                                const std::string& content_type = "application/json") {
    CURL* handle = curl_easy_init();
    if (handle == nullptr) {
        throw std::runtime_error("curl_easy_init failed");
    }

    std::string body;
    struct curl_slist* headers = nullptr;
    if (!post_body.empty()) {
        headers = curl_slist_append(headers, ("Content-Type: " + content_type).c_str());
        curl_easy_setopt(handle, CURLOPT_POSTFIELDS, post_body.c_str());
    }
    curl_easy_setopt(handle, CURLOPT_URL, url.c_str());
    curl_easy_setopt(handle, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(handle, CURLOPT_WRITEFUNCTION,
                     +[](char* data, std::size_t size, std::size_t nmemb, void* userp) -> std::size_t {
                         static_cast<std::string*>(userp)->append(data, size * nmemb);
                         return size * nmemb;
                     });
    curl_easy_setopt(handle, CURLOPT_WRITEDATA, &body);
    curl_easy_setopt(handle, CURLOPT_TIMEOUT, 10L);
    curl_easy_setopt(handle, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(handle, CURLOPT_USERAGENT, "TigerEx/1.0");

    CURLcode code = curl_easy_perform(handle);
    long status = 0;
    curl_easy_getinfo(handle, CURLINFO_RESPONSE_CODE, &status);
    curl_slist_free_all(headers);
    curl_easy_cleanup(handle);

    if (code != CURLE_OK) {
        throw std::runtime_error(std::string("http request failed: ") + curl_easy_strerror(code));
    }
    if (status < 200 || status >= 300) {
        throw std::runtime_error("http request returned status " + std::to_string(status));
    }
    return body;
}

/// Call an EVM JSON-RPC method and return the `result` field.
inline std::string evm_rpc_call(const std::string& rpc_url,
                                const std::string& method,
                                const std::string& params = "[]") {
    nlohmann::json payload = {
        {"jsonrpc", "2.0"}, {"id", 1}, {"method", method}, {"params", nlohmann::json::parse(params)}};
    auto response = nlohmann::json::parse(http_request(rpc_url, payload.dump()));
    if (response.contains("error")) {
        throw std::runtime_error("rpc error: " + response["error"].dump());
    }
    if (!response.contains("result")) {
        throw std::runtime_error("rpc response has no result");
    }
    return response["result"].get<std::string>();
}

/// Parse a 64-bit unsigned amount from a JSON value.
///
/// Amounts are handled as decimal strings, because a JSON number large enough to
/// hold a token balance in base units (for example 10^24) exceeds what a double
/// can represent exactly, and nlohmann's integer conversion silently yields 0
/// instead of reporting the overflow. A bare JSON integer is accepted, but only
/// when it fits.
inline uint64_t json_uint64(const nlohmann::json& value, const std::string& field) {
    if (value.is_string()) {
        const std::string& text = value.get_ref<const std::string&>();
        if (text.empty() || text.find_first_not_of("0123456789") != std::string::npos) {
            throw std::runtime_error(field + " must be a decimal string of digits, got \"" + text + "\"");
        }
        try {
            return std::stoull(text);
        } catch (const std::out_of_range&) {
            throw std::runtime_error(field + " does not fit in 64 bits: " + text);
        }
    }
    if (value.is_number_unsigned()) {
        return value.get<uint64_t>();
    }
    throw std::runtime_error(field + " must be an unsigned integer or a decimal string");
}

/// Read `field` from `object` as a 64-bit unsigned amount.
inline uint64_t json_uint64_field(const nlohmann::json& object, const std::string& field,
                                  uint64_t fallback) {
    auto it = object.find(field);
    if (it == object.end()) {
        return fallback;
    }
    return json_uint64(*it, field);
}

/// A price oracle backed by a public aggregator. Results are cached for a short
/// window; the cache only ever holds values that were actually fetched.
class CoinGeckoOracle {
public:
    explicit CoinGeckoOracle(std::string base_url = "https://api.coingecko.com/api/v3",
                             std::chrono::seconds ttl = std::chrono::seconds(30))
        : base_url_(std::move(base_url)), ttl_(ttl) {}

    /// Price of `coin_id` in `vs_currency`, or nullopt when unavailable.
    std::optional<double> price(const std::string& coin_id, const std::string& vs_currency = "usd") {
        std::lock_guard<std::mutex> lock(mutex_);

        auto now = std::chrono::steady_clock::now();
        auto key = coin_id + "/" + vs_currency;
        auto it = cache_.find(key);
        if (it != cache_.end() && now - it->second.fetched_at < ttl_) {
            return it->second.value;
        }

        std::string url = base_url_ + "/simple/price?ids=" + coin_id + "&vs_currencies=" + vs_currency;
        nlohmann::json parsed;
        try {
            parsed = nlohmann::json::parse(http_request(url));
        } catch (const std::exception&) {
            return std::nullopt;
        }
        if (!parsed.contains(coin_id) || !parsed[coin_id].contains(vs_currency)) {
            return std::nullopt;
        }
        double value = parsed[coin_id][vs_currency].get<double>();
        if (!(value > 0.0)) {
            return std::nullopt;
        }
        cache_[key] = {value, now};
        return value;
    }

private:
    struct Entry {
        double value;
        std::chrono::steady_clock::time_point fetched_at;
    };

    std::string base_url_;
    std::chrono::seconds ttl_;
    std::mutex mutex_;
    std::unordered_map<std::string, Entry> cache_;
};

/// Reads the current gas price from an EVM node. Throws when the node does not
/// answer, so a caller never silently falls back to a made-up number.
inline double evm_gas_price(const std::string& rpc_url) {
    std::string hex_price = evm_rpc_call(rpc_url, "eth_gasPrice");
    unsigned long long wei = std::stoull(hex_price, nullptr, 16);
    return static_cast<double>(wei);
}

}  // namespace market_data
}  // namespace tigerex

#endif  // TIGEREX_MARKET_DATA_HPP
