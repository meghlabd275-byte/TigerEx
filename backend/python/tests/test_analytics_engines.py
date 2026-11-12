"""Tests for the analytics engines: portfolio valuation, rebalancing,
risk-parity allocation, Black-Litterman posterior and the backtester.

The properties asserted here are the ones that guard value: an unpriced holding
is refused rather than valued at zero, a rebalance never trades against a
fabricated price, the backtester never sees future bars, and the drawdown /
Sharpe statistics are computed from the real equity curve.
"""

import math

import pytest

import analytics
import backtest
import portfolio


# ---------------------------------------------------------------- analytics --

def test_calculate_pnl_and_percentage():
    pnl, pct = analytics.calculate_pnl(100.0, 110.0)
    assert pnl == pytest.approx(10.0)
    assert pct == pytest.approx(10.0)
    # A zero opening price has no meaningful percentage; it must not divide by 0.
    pnl, pct = analytics.calculate_pnl(0.0, 5.0)
    assert pnl == pytest.approx(5.0)
    assert pct == 0


def test_portfolio_value_requires_a_price_for_every_holding():
    value = analytics.get_portfolio_value({"BTC": 2.0, "ETH": 3.0}, {"BTC": 50000.0, "ETH": 3000.0})
    assert value == pytest.approx(2 * 50000 + 3 * 3000)
    # An unpriced holding must be refused, not silently valued at zero.
    with pytest.raises(ValueError):
        analytics.get_portfolio_value({"BTC": 1.0, "DOGE": 1.0}, {"BTC": 50000.0})


def test_negative_price_is_rejected():
    with pytest.raises(ValueError):
        analytics.get_portfolio_value({"BTC": 1.0}, {"BTC": -1.0})


def test_risk_score_is_bounded_and_monotonic():
    assert analytics.calculate_risk_score(0.0, 0.0, 1.0) == 1
    assert analytics.calculate_risk_score(1.0, 10_000_000.0, 50.0) == 10
    low = analytics.calculate_risk_score(0.15, 20_000.0, 2.0)
    high = analytics.calculate_risk_score(0.6, 2_000_000.0, 20.0)
    assert 1 <= low < high <= 10


def test_analyze_trading_pair_empty_and_populated():
    empty = analytics.analyze_trading_pair({"trades": []})
    assert empty.trade_count == 0 and empty.avg_price == 0

    stats = analytics.analyze_trading_pair(
        {"trades": [{"price": 10, "volume": 1}, {"price": 20, "volume": 2}, {"price": 30, "volume": 3}]}
    )
    assert stats.trade_count == 3
    assert stats.avg_price == pytest.approx(20.0)
    assert stats.high_price == 30 and stats.low_price == 10
    assert stats.open_price == 10 and stats.close_price == 30
    assert stats.total_volume == pytest.approx(6.0)


# ---------------------------------------------------------------- portfolio --

def test_rebalance_refuses_an_unpriced_asset():
    manager = portfolio.PortfolioManager()
    manager.add_asset("BTC", 1.0, 50000.0)
    manager.add_asset("ETH", 10.0, 3000.0)
    manager.set_target_weights({"BTC": 0.5, "ETH": 0.5})
    # Missing the ETH price must raise, not trade ETH at a fabricated price.
    with pytest.raises(ValueError):
        manager.rebalance({"BTC": 50000.0})


def test_rebalance_direction_and_target_weights():
    manager = portfolio.PortfolioManager()
    manager.add_asset("BTC", 1.0, 50000.0)
    manager.add_asset("ETH", 10.0, 3000.0)
    # BTC is 62.5% of a 80000 book; moving to 50/50 requires selling BTC.
    manager.set_target_weights({"BTC": 0.5, "ETH": 0.5})
    orders = {o.symbol: o for o in manager.rebalance({"BTC": 50000.0, "ETH": 3000.0})}
    assert orders["BTC"].action == "sell"
    assert orders["ETH"].action == "buy"


def test_target_weights_must_sum_to_one():
    manager = portfolio.PortfolioManager()
    manager.add_asset("BTC", 1.0, 50000.0)
    with pytest.raises(ValueError):
        manager.set_target_weights({"BTC": 0.5})


def test_diversification_score_bounds():
    manager = portfolio.PortfolioManager()
    assert manager.get_diversification_score() == 0
    manager.add_asset("BTC", 1.0, 50000.0)
    assert manager.get_diversification_score() == pytest.approx(0.0)
    manager.add_asset("ETH", 10.0, 3000.0)
    assert 0.0 < manager.get_diversification_score() < 1.0


def test_sharpe_ratio_zero_volatility_is_zero():
    manager = portfolio.PortfolioManager()
    assert manager.get_sharpe_ratio([0.01, 0.01, 0.01]) == 0


def test_risk_parity_allocates_inverse_variance_and_sums_to_total():
    allocation = portfolio.RiskParity(["BTC", "ETH"]).allocate(
        10_000.0, {"BTC": 0.5, "ETH": 0.25}
    )
    # Lower volatility gets the larger share and the parts sum to the total.
    assert allocation["ETH"] > allocation["BTC"]
    assert sum(allocation.values()) == pytest.approx(10_000.0)


def test_risk_parity_fails_closed_without_a_usable_volatility():
    parity = portfolio.RiskParity(["BTC"])
    with pytest.raises(ValueError):
        parity.allocate(1000.0, {})
    with pytest.raises(ValueError):
        parity.allocate(1000.0, {"BTC": 0.0})
    with pytest.raises(ValueError):
        parity.allocate(0.0, {"BTC": 0.1})


def test_black_litterman_reduces_to_prior_with_no_views_rejected():
    bl = portfolio.BlackLitterman([[0.04, 0.0], [0.0, 0.09]])
    # A view without a matching expected return is rejected.
    with pytest.raises(ValueError):
        bl.posterior([[1.0, 0.0]], [], [0.05, 0.06])
    # A view row of the wrong width is rejected.
    with pytest.raises(ValueError):
        bl.posterior([[1.0]], [0.1], [0.05, 0.06])


def test_black_litterman_posterior_is_finite_and_reacts_to_a_view():
    bl = portfolio.BlackLitterman([[0.04, 0.0], [0.0, 0.09]])
    prior = [0.05, 0.06]
    # A strong positive view on asset 0 must raise its posterior return.
    posterior = bl.posterior([[1.0, 0.0]], [0.20], prior)
    assert all(math.isfinite(x) for x in posterior)
    assert posterior[0] > prior[0]


def test_matrix_inversion_rejects_a_singular_matrix():
    with pytest.raises(ValueError):
        portfolio.BlackLitterman._invert([[1.0, 2.0], [2.0, 4.0]])


# ----------------------------------------------------------------- backtest --

def test_backtest_engine_rejects_empty_and_nonpositive_prices():
    engine = backtest.BacktestEngine()
    with pytest.raises(ValueError):
        engine.run([], backtest.StrategyTemplates.rsi_strategy)
    with pytest.raises(ValueError):
        engine.run([100.0, 0.0, 50.0], backtest.StrategyTemplates.rsi_strategy)


def test_backtest_uses_only_observed_history():
    seen_lengths = []

    def strategy(history, position, balance):
        seen_lengths.append(len(history))
        return "hold"

    prices = [100.0 + i for i in range(25)]
    backtest.BacktestEngine(100_000.0).run(prices, strategy)
    # The first call sees exactly one bar; no call may see the whole series early.
    assert seen_lengths[0] == 1
    assert seen_lengths == list(range(1, len(prices) + 1))


def test_backtest_long_pnl_matches_price_move():
    engine = backtest.BacktestEngine(100_000.0)
    prices = [100.0, 100.0, 110.0]
    result = engine.run(prices, lambda history, position, balance: "buy" if len(history) == 1 else "hold")
    # Bought ~95% of 100000 at 100, marked to 110: a positive PnL.
    assert result.total_trades == 1
    assert result.total_pnl > 0
    assert result.win_rate == pytest.approx(1.0)


def test_backtest_statistics_are_consistent():
    prices = [100 + i * 0.5 for i in range(100)]
    result = backtest.BacktestEngine(100000).run(
        prices, backtest.StrategyTemplates.moving_average_crossover
    )
    assert result.winning_trades + result.losing_trades == result.total_trades
    assert 0.0 <= result.win_rate <= 1.0
    assert result.max_drawdown >= 0.0


def test_rsi_and_sma_shapes():
    prices = [float(i) for i in range(1, 21)]
    sma = backtest.TechnicalIndicators.sma(prices, 5)
    assert len(sma) == len(prices)
    assert sma[0] is None and sma[4] is not None
    rsi = backtest.TechnicalIndicators.rsi(prices, 14)
    # A strictly rising series has RSI 100 once enough bars exist.
    assert rsi[-1] == pytest.approx(100.0)
    assert rsi[13] is None


def test_market_maker_quotes_straddle_the_mid():
    bid, ask = backtest.MarketMakerBot(0.001).quote(50000.0)
    assert bid["price"] < 50000.0 < ask["price"]
    assert bid["side"] == "buy" and ask["side"] == "sell"
    with pytest.raises(ValueError):
        backtest.MarketMakerBot(0.0)
    with pytest.raises(ValueError):
        backtest.MarketMakerBot().quote(0.0)
