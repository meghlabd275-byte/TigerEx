// Regression tests for the reporting engine. They prove the report totals are
// computed from the trades that were actually loaded and that the compliance
// check measures real volume instead of a value fixed at zero.

#include <cmath>
#include <cstdio>
#include <fstream>
#include <iostream>
#include <string>

#define TIGEREX_REPORTING_NO_MAIN
#include "../src/reporting.cpp"

namespace {

int failures = 0;

void check(bool condition, const char* message) {
    if (condition) {
        std::cout << "ok: " << message << std::endl;
    } else {
        std::cout << "FAIL: " << message << std::endl;
        failures++;
    }
}

std::string write_temp(const std::string& contents) {
    const std::string path = "/tmp/tigerex_reporting_test.csv";
    std::ofstream out(path);
    out << contents;
    out.close();
    return path;
}

}  // namespace

int main() {
    // Two trades: volume = 50000*0.1 + 51000*0.1 = 10100, fees = 10.1.
    const std::string path = write_temp(
        "# id,timestamp,symbol,side,price,quantity,fee,pnl\n"
        "1,1234567890,BTC/USDT,BUY,50000,0.1,5,0\n"
        "2,1234567891,BTC/USDT,SELL,51000,0.1,5.1,10\n");

    ReportGenerator rg;
    check(load_trades(path, rg), "loads a valid trade file");
    check(rg.trade_count() == 2, "loads both trades");

    check(std::abs(rg.total_volume() - 10100.0) < 1e-6, "volume is computed from trades");

    const std::string daily = rg.generate_daily_report();
    check(daily.find("Total Trades: 2") != std::string::npos, "daily report counts trades");
    check(daily.find("Volume: $10100.00") != std::string::npos, "daily report sums volume");

    const std::string tax = rg.generate_tax_report();
    check(tax.find("Realized PnL: $10.00") != std::string::npos, "tax report sums realized PnL");
    check(tax.find("Unrealized PnL: n/a") != std::string::npos,
          "tax report does not invent unrealized PnL");

    // Compliance: 10100 of volume exceeds a 5000 threshold and not a 20000 one.
    check(ComplianceChecker::check_volume(rg.total_volume(), 5000.0, 0).size() == 1,
          "flags volume above the threshold");
    check(ComplianceChecker::check_volume(rg.total_volume(), 20000.0, 0).empty(),
          "does not flag volume below the threshold");

    // Malformed and out-of-range input is rejected, not silently ignored.
    check(!load_trades(write_temp("1,2,BTC/USDT,BUY,50000,0.1\n"), rg), "rejects a short line");
    ReportGenerator rg2;
    check(!load_trades(write_temp("1,2,BTC/USDT,SIDEWAYS,50000,0.1,5,0\n"), rg2),
          "rejects an unknown side");
    ReportGenerator rg3;
    check(!load_trades(write_temp("1,2,BTC/USDT,BUY,abc,0.1,5,0\n"), rg3),
          "rejects a non-numeric price");
    ReportGenerator rg4;
    check(!load_trades("/tmp/tigerex_missing_reporting_file.csv", rg4),
          "fails when the input file is missing");

    std::remove(path.c_str());
    std::cout << (failures == 0 ? "ALL PASSED" : "FAILURES") << std::endl;
    return failures == 0 ? 0 : 1;
}
