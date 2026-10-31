/**
 * TigerEx integration tests.
 *
 * These exercise the real code paths: chain/pool configuration is loaded from a
 * temporary config directory, keys are real secp256k1 keys, signatures are
 * really verified, and the failure cases (unknown chain, no bridge, missing
 * hash) must throw rather than return a plausible-looking value.
 */

#include "tigerex_integrations.hpp"

#include <cassert>
#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>

using namespace tigerex::integrations;

namespace {

int failures = 0;

#define CHECK(cond)                                                                       \
    do {                                                                                  \
        if (!(cond)) {                                                                    \
            std::cerr << "FAIL: " << __FILE__ << ":" << __LINE__ << "  " << #cond << "\n"; \
            ++failures;                                                                   \
        }                                                                                 \
    } while (false)

#define CHECK_THROWS(expr)                                                                    \
    do {                                                                                      \
        bool threw = false;                                                                   \
        try {                                                                                 \
            (void)(expr);                                                                     \
        } catch (const std::exception&) {                                                     \
            threw = true;                                                                     \
        }                                                                                     \
        if (!threw) {                                                                         \
            std::cerr << "FAIL: expected throw at " << __FILE__ << ":" << __LINE__ << "\n";    \
            ++failures;                                                                       \
        }                                                                                     \
    } while (false)

std::string make_config_dir() {
    auto dir = std::filesystem::temp_directory_path() /
               ("tigerex-test-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
    std::filesystem::create_directories(dir);

    std::ofstream chains(dir / "chains.json");
    chains << R"({
      "tgr_token_address": "0x1111111111111111111111111111111111111111",
      "rusd_token_address": "0x2222222222222222222222222222222222222222",
      "chains": [
        {"chain_id": "0x1", "name": "tiger_mainnet", "rpc_url": "https://ethereum-rpc.publicnode.com",
         "explorer_url": "https://example.invalid", "symbol": "TGR", "decimals": 18, "block_time": 2000}
      ],
      "tokens": [
        {"symbol": "TGR", "name": "Tiger", "address": "0x1111111111111111111111111111111111111111",
         "decimals": 18, "native": true, "total_supply": 1000000000, "verified": true},
        {"symbol": "RUSD", "name": "Royal Tiger USD", "address": "0x2222222222222222222222222222222222222222",
         "decimals": 6, "total_supply": 1000000000, "verified": true}
      ],
      "bridges": [
        {"bridge_address": "0x3333333333333333333333333333333333333333", "source_chain": "ethereum",
         "target_chain": "tiger_mainnet", "min_amount": 100, "max_amount": 1000000,
         "fee_percentage": 0.001, "estimated_time": 600000}
      ]
    })";
    chains.close();

    std::ofstream dex(dir / "dex.json");
    dex << R"({
      "pools": [
        {"pool_id": "pool_tgr_usdt", "token_a": "0xTGR", "token_b": "0xUSDT",
         "reserve_a": "1000000000000000000000000", "reserve_b": "5000000000000", "fee_rate": 0.003},
        {"pool_id": "pool_tgr_rusd", "token_a": "0xTGR", "token_b": "0xRUSD",
         "reserve_a": "1000000000000000000000000", "reserve_b": "5000000000000", "fee_rate": 0.003}
      ],
      "farms": [
        {"farm_id": "farm_tgr", "pool_id": "pool_tgr_usdt", "reward_token": "0xTGR",
         "reward_rate": "1000000000000000000000", "apy": 0.25, "start_time": 0, "end_time": 4102444800000}
      ]
    })";
    dex.close();

    setenv("TIGEREX_CONFIG_DIR", dir.c_str(), 1);
    return dir.string();
}

void test_chain_config_loading() {
    std::cout << "test_chain_config_loading\n";

    TigerSmartChain chain;
    auto chains = chain.get_all_chains();
    CHECK(chains.size() == 1);
    CHECK(chains.front().name == "tiger_mainnet");
    CHECK(chains.front().symbol == "TGR");

    auto tokens = chain.get_all_tokens();
    CHECK(tokens.size() == 2);

    auto tgr = chain.get_token_by_symbol("TGR");
    CHECK(tgr.has_value());
    CHECK(tgr->name == "Tiger");
    // No price id configured, so there is no price: 0 means "unknown", not "free".
    CHECK(tgr->price_usd == 0.0);

    CHECK(chain.get_tgr_token() == "0x1111111111111111111111111111111111111111");
    CHECK(chain.get_rusd_token() == "0x2222222222222222222222222222222222222222");

    // An unknown chain has no gas price; the call must throw, not invent one.
    CHECK_THROWS(chain.get_gas_price("no_such_chain"));

    // A configured bridge yields its real fee; an unconfigured route throws.
    CHECK(chain.estimate_bridge_fee(1000, "ethereum", "tiger_mainnet") == 1.0);
    CHECK_THROWS(chain.estimate_bridge_fee(1000, "solana", "tiger_mainnet"));
}

void test_live_gas_price() {
    std::cout << "test_live_gas_price\n";

    // The gas price comes from a live RPC endpoint, so this check is skipped
    // rather than failed when the sandbox has no outbound network. Nothing is
    // substituted for the real value.
    TigerSmartChain chain;
    double gas = 0.0;
    try {
        gas = chain.get_gas_price("tiger_mainnet");
    } catch (const std::exception& e) {
        std::cout << "  skipped, no reachable RPC: " << e.what() << "\n";
        return;
    }
    CHECK(gas > 0.0);
    std::cout << "  live gas price (wei): " << gas << "\n";
}

void test_dex_from_config() {
    std::cout << "test_dex_from_config\n";

    TigerswapDEX dex;
    auto pools = dex.get_all_pools();
    CHECK(pools.size() == 2);

    auto farms = dex.get_farms();
    CHECK(farms.size() == 1);
    CHECK(farms.front().farm_id == "farm_tgr");

    // 1 TGR in, against a pool holding 10^24 TGR base units (10^6 TGR) and
    // 5*10^12 USDT base units (5*10^6 USDT).
    const Amount one_tgr = static_cast<Amount>(1000000000000000000ULL);
    const double spot = 5000000000000.0 / 1000000000000000000000000.0;

    auto quote = dex.get_quote("0xTGR", "0xUSDT", one_tgr);
    CHECK(quote.amount_out > 0);
    CHECK(quote.pool_id == "pool_tgr_usdt");
    // Constant product: the realised price is below spot, and only slightly so
    // for an input this small relative to the reserve.
    CHECK(quote.execution_price < spot);
    CHECK(quote.execution_price > spot * 0.99);

    // A much larger input moves the price against the trader.
    auto big = dex.get_quote("0xTGR", "0xUSDT", one_tgr * 1000);
    CHECK(big.execution_price < quote.execution_price);

    // Fail-closed cases.
    CHECK_THROWS(dex.get_quote("0xTGR", "0xUSDT", Amount(0)));
    CHECK_THROWS(dex.get_quote("0xTGR", "0xTGR", Amount(1000)));
    CHECK_THROWS(dex.get_quote("0xNOPE", "0xUSDT", Amount(1000)));
    CHECK_THROWS(dex.get_quote("0xTGR", "0xNOPE", Amount(1000)));
    CHECK_THROWS(dex.add_liquidity("0xTGR", "0xUSDT", Amount(0), Amount(0)));

    // Depositing liquidity adds to the reserve and charges no trade fee. The
    // deposit is deliberately lopsided (mostly USDT), which deepens the quote
    // side and so improves the output for the same input.
    uint64_t before = dex.get_total_fees();
    CHECK(dex.add_liquidity("0xTGR", "0xUSDT", Amount(1), static_cast<Amount>(5000000000000ULL)));
    CHECK(dex.get_total_fees() == before);

    auto quote2 = dex.get_quote("0xTGR", "0xUSDT", one_tgr);
    CHECK(quote2.amount_out > quote.amount_out);
}

void test_wallet_crypto() {
    std::cout << "test_wallet_crypto\n";

    TigerWallet wallet;
    std::string address = wallet.create_wallet("user-1", "Test Wallet");
    CHECK(!address.empty());
    // A real EIP-55 checksummed EVM address.
    CHECK(address.rfind("0x", 0) == 0);
    CHECK(address.size() == 42);

    auto acct = wallet.get_wallet(address);
    CHECK(acct.has_value());
    CHECK(acct->public_key.size() == 130);
    CHECK(acct->public_key_compressed.size() == 66);

    std::string signature = wallet.sign_message(address, "Hello TigerEx");
    CHECK(!signature.empty());
    CHECK(wallet.verify_signature(address, "Hello TigerEx", signature));
    // A different message must not verify.
    CHECK(!wallet.verify_signature(address, "Hello TigerEx!", signature));

    // An unknown wallet has no key and must not sign.
    CHECK(wallet.sign_message("0xdeadbeef", "x").empty());
    CHECK(!wallet.verify_signature("0xdeadbeef", "x", signature));

    // A hardware wallet never exposes its key to this process.
    std::string hw = wallet.create_wallet("user-1", "Ledger", true);
    CHECK(wallet.sign_message(hw, "x").empty());

    // Wallets are scoped to their owner.
    auto user1 = wallet.get_user_wallets("user-1");
    CHECK(user1.size() == 2);
    for (const auto& w : user1) {
        CHECK(w.user_id == "user-1");
    }
    CHECK(wallet.get_user_wallets("nobody").empty());
}

void test_transaction_recording() {
    std::cout << "test_transaction_recording\n";

    TigerWallet wallet;
    std::string address = wallet.create_wallet("user-2", "Tx Wallet");

    WalletTransaction tx;
    tx.from = address;
    tx.to = "0x4444444444444444444444444444444444444444";
    tx.amount = 1000;
    tx.chain_id = "0x1";
    tx.nonce = 1;

    // No hash: the wallet cannot broadcast, so this must be rejected.
    tx.status = "pending";
    CHECK_THROWS(wallet.record_transaction(tx));

    // Claiming "confirmed" without a confirmation is rejected.
    tx.hash = "0xabc";
    tx.status = "confirmed";
    CHECK_THROWS(wallet.record_transaction(tx));

    tx.confirmations = 3;
    std::string hash = wallet.record_transaction(tx);
    CHECK(hash == "0xabc");

    auto history = wallet.get_transactions(address, 10);
    CHECK(history.size() == 1);
    CHECK(history.front().status == "confirmed");
}

void test_fee_collection() {
    std::cout << "test_fee_collection\n";

    TigerExIntegration integration;
    integration.add_exchange_fee(1000);
    integration.add_bridge_fee(500);
    integration.add_wallet_fee(100);
    integration.add_dex_fee(0);

    CHECK(integration.get_exchange_fees() == 1000);
    CHECK(integration.get_bridge_fees() == 500);
    CHECK(integration.get_wallet_fees() == 100);
    CHECK(integration.get_dex_fees() == 0);
    CHECK(integration.collect_all_fees() == 1600);
}

void test_swap_benchmark() {
    std::cout << "test_swap_benchmark\n";

    TigerswapDEX dex;
    const int iterations = 100000;

    auto start = std::chrono::high_resolution_clock::now();
    for (int i = 0; i < iterations; ++i) {
        auto quote = dex.get_quote("0xTGR", "0xUSDT", Amount(1000000000000000000ULL));
        (void)quote;
    }
    auto end = std::chrono::high_resolution_clock::now();
    auto micros = std::chrono::duration_cast<std::chrono::microseconds>(end - start).count();
    CHECK(micros > 0);
    std::cout << "  " << iterations << " quotes in " << micros << " us ("
              << (static_cast<long long>(iterations) * 1000000 / micros) << " quotes/sec)\n";
}

}  // namespace

int main() {
    std::string dir = make_config_dir();
    std::cout << "config dir: " << dir << "\n";

    try {
        test_chain_config_loading();
        test_live_gas_price();
        test_dex_from_config();
        test_wallet_crypto();
        test_transaction_recording();
        test_fee_collection();
        test_swap_benchmark();
    } catch (const std::exception& e) {
        std::cerr << "unexpected exception: " << e.what() << "\n";
        return 1;
    }

    std::filesystem::remove_all(dir);

    if (failures != 0) {
        std::cerr << failures << " check(s) failed\n";
        return 1;
    }
    std::cout << "All integration tests passed\n";
    return 0;
}
