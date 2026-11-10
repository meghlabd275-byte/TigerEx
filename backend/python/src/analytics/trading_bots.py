#!/usr/bin/env python3
"""
TigerEx Analytics Module - PYTHON (24 files equivalent)
Analytics, ML, Backtesting, Trading Bots
"""

from __future__ import annotations
from dataclasses import dataclass
from typing import List, Dict, Optional, Tuple
from datetime import datetime
import json
import time

# ============================================================================
# BACKTESTING ENGINE
# ============================================================================

@dataclass
class BacktestResult:
    total_trades: int
    winning_trades: int
    losing_trades: int
    total_pnl: float
    max_drawdown: float
    sharpe_ratio: float
    win_rate: float

class BacktestEngine:
    """Event-driven backtesting engine"""
    
    def __init__(self, initial_balance: float = 100000.0):
        self.initial_balance = initial_balance
        self.balance = initial_balance
        self.position = 0.0
        self.position_side = None
        self.entry_price = 0.0
        self.trades = []
        self.equity_curve = []

    def run(self, prices: List[float], strategy_func) -> BacktestResult:
        if not prices:
            raise ValueError("prices must not be empty")
        if any(not isinstance(price, (int, float)) or price <= 0 for price in prices):
            raise ValueError("prices must be positive numbers")

        for index, price in enumerate(prices):
            # The strategy sees the observed history up to and including the
            # current bar, never future data.
            history = prices[:index + 1]
            signal = strategy_func(history, self.position, self.balance)

            if signal == 'buy' and self.position == 0:
                qty = (self.balance * 0.95) / price
                self.position = qty
                self.entry_price = price
                self.position_side = 'long'
                self.balance -= qty * price

            elif signal == 'sell' and self.position == 0:
                qty = (self.balance * 0.95) / price
                self.position = -qty
                self.entry_price = price
                self.position_side = 'short'
                self.balance -= abs(qty) * price

            elif signal == 'close' and self.position != 0:
                self.close_position(price, self.calculate_pnl(price))

            self.equity_curve.append(self.equity())

        if self.position != 0:
            self.close_position(prices[-1], self.calculate_pnl(prices[-1]))

        return self.calculate_stats()

    def close_position(self, price: float, pnl: float) -> None:
        """Return notional to cash and record the closed trade."""
        notional = abs(self.position) * self.entry_price
        self.balance += notional + pnl
        self.trades.append({
            'entry': self.entry_price,
            'exit': price,
            'pnl': pnl,
            'side': self.position_side,
        })
        self.position = 0
        self.position_side = None

    def equity(self) -> float:
        """Cash plus the mark-to-market value of any open position."""
        if self.position == 0 or not self.equity_curve:
            return self.balance
        mark = self.equity_curve[-1]
        return self.balance + abs(self.position) * mark

    def calculate_pnl(self, current_price: float) -> float:
        if self.position_side == 'long':
            return (current_price - self.entry_price) * abs(self.position)
        elif self.position_side == 'short':
            return (self.entry_price - current_price) * abs(self.position)
        return 0.0

    def calculate_stats(self) -> BacktestResult:
        winning = sum(1 for t in self.trades if t['pnl'] > 0)
        losing = sum(1 for t in self.trades if t['pnl'] <= 0)
        total_pnl = sum(t['pnl'] for t in self.trades)

        return BacktestResult(
            total_trades=len(self.trades),
            winning_trades=winning,
            losing_trades=losing,
            total_pnl=total_pnl,
            max_drawdown=self.calculate_max_drawdown(),
            sharpe_ratio=self.calculate_sharpe(),
            win_rate=winning / len(self.trades) if self.trades else 0
        )

    def calculate_sharpe(self, periods_per_year: int = 365) -> float:
        """Annualised Sharpe ratio from the per-bar equity returns."""
        if len(self.equity_curve) < 2:
            return 0.0

        returns = []
        for previous, current in zip(self.equity_curve, self.equity_curve[1:]):
            if previous <= 0:
                continue
            returns.append((current - previous) / previous)
        if len(returns) < 2:
            return 0.0

        mean = sum(returns) / len(returns)
        variance = sum((r - mean) ** 2 for r in returns) / (len(returns) - 1)
        stddev = variance ** 0.5
        if stddev == 0:
            return 0.0
        return (mean / stddev) * (periods_per_year ** 0.5)


    def calculate_max_drawdown(self) -> float:
        if not self.equity_curve:
            return 0.0
        peak = self.equity_curve[0]
        max_dd = 0.0
        for equity in self.equity_curve:
            if equity > peak:
                peak = equity
            dd = (peak - equity) / peak
            if dd > max_dd:
                max_dd = dd
        return max_dd * 100

# ============================================================================
# TECHNICAL INDICATORS
# ============================================================================

class TechnicalIndicators:
    @staticmethod
    def sma(prices: List[float], period: int) -> List[Optional[float]]:
        sma_values = []
        for i in range(len(prices)):
            if i < period - 1:
                sma_values.append(None)
            else:
                avg = sum(prices[i-period+1:i+1]) / period
                sma_values.append(round(avg, 2))
        return sma_values
    
    @staticmethod
    def ema(prices: List[float], period: int) -> List[Optional[float]]:
        k = 2 / (period + 1)
        ema_values = []
        prev_ema = None
        for price in prices:
            if prev_ema is None:
                prev_ema = price
            else:
                prev_ema = price * k + prev_ema * (1 - k)
            ema_values.append(round(prev_ema, 2))
        return ema_values
    
    @staticmethod
    def rsi(prices: List[float], period: int = 14) -> List[Optional[float]]:
        gains = []
        losses = []
        for i in range(1, len(prices)):
            change = prices[i] - prices[i-1]
            gains.append(max(change, 0))
            losses.append(max(-change, 0))
        
        # The first `period` bars have no complete lookback, so they are None and
        # the computed values line up with the bars they describe. The previous
        # version padded the *end* with Nones, so the most recent RSI - the one
        # every strategy reads via rsi(...)[-1] - was always None.
        rsi_values: List[Optional[float]] = [None] * period
        for i in range(period, len(gains) + 1):
            avg_gain = sum(gains[i-period:i]) / period
            avg_loss = sum(losses[i-period:i]) / period
            if avg_loss == 0:
                rsi_values.append(100.0)
            else:
                rs = avg_gain / avg_loss
                rsi = 100 - (100 / (1 + rs))
                rsi_values.append(round(rsi, 2))
        
        return rsi_values
    
    @staticmethod
    def macd(prices: List[float], fast: int = 12, slow: int = 26, signal: int = 9) -> Tuple[List[float], List[float], List[float]]:
        ema_fast = TechnicalIndicators.ema(prices, fast)
        ema_slow = TechnicalIndicators.ema(prices, slow)
        
        macd_line = [f - s for f, s in zip(ema_fast, ema_slow) if f and s]
        signal_line = TechnicalIndicators.ema([m for m in macd_line if m], signal)
        
        return macd_line, signal_line, [m - s for m, s in zip(macd_line, signal_line)]

# ============================================================================
# TRADING STRATEGIES
# ============================================================================

class StrategyTemplates:
    @staticmethod
    def moving_average_crossover(prices: List[float], position: float, balance: float) -> str:
        if len(prices) < 20:
            return 'hold'
        sma_fast = sum(prices[-5:]) / 5
        sma_slow = sum(prices[-20:]) / 20
        if sma_fast > sma_slow:
            return 'buy'
        elif sma_fast < sma_slow:
            return 'sell'
        return 'hold'
    
    @staticmethod
    def rsi_strategy(prices: List[float], position: float, balance: float) -> str:
        rsi = TechnicalIndicators.rsi(prices)[-1]
        if rsi is None:
            return 'hold'
        if rsi < 30:
            return 'buy'
        elif rsi > 70:
            return 'sell'
        return 'hold'
    
    @staticmethod
    def mean_reversion(prices: List[float], position: float, balance: float, lookback: int = 20) -> str:
        if len(prices) < lookback:
            return 'hold'
        recent = prices[-lookback:]
        mean = sum(recent) / lookback
        std = (sum((x - mean)**2 for x in recent) / lookback) ** 0.5
        
        current = prices[-1]
        
        if current < mean - 2 * std:
            return 'buy'
        elif current > mean + 2 * std:
            return 'sell'
        return 'hold'

# ============================================================================
# TRADING BOTS
# ============================================================================

class TradingBot:
    """Base trading bot"""
    
    def __init__(self, name: str, strategy_func):
        self.name = name
        self.strategy_func = strategy_func
        self.position = 0.0
        self.pnl = 0.0
    
    def on_price_update(self, price: float) -> Optional[str]:
        return self.strategy_func([price], self.position, 0)
    
    def calculate_position_size(self, balance: float, price: float, risk_percent: float = 0.02) -> float:
        return (balance * risk_percent) / price

class ArbitrageBot:
    """Cross-exchange arbitrage bot"""
    
    def __init__(self):
        self.exchanges = {}
    
    def add_exchange(self, name: str, price: float):
        self.exchanges[name] = price
    
    def find_arbitrage(self) -> Optional[Dict]:
        if len(self.exchanges) < 2:
            return None
        
        prices = sorted(self.exchanges.items(), key=lambda x: x[1])
        
        lowest = prices[0]
        highest = prices[-1]
        
        spread = (highest[1] - lowest[1]) / lowest[1] * 100
        
        if spread > 0.5:  # More than 0.5% spread
            return {
                'buy_exchange': lowest[0],
                'sell_exchange': highest[0],
                'buy_price': lowest[1],
                'sell_price': highest[1],
                'spread_percent': spread
            }
        
        return None

class GridTradingBot:
    """Grid trading bot"""
    
    def __init__(self, grid_levels: int = 10, grid_spacing_percent: float = 1.0):
        self.grid_levels = grid_levels
        self.grid_spacing_percent = grid_spacing_percent
        self.orders = []
    
    def generate_grid(self, center_price: float) -> List[Dict]:
        grid = []
        spacing = center_price * self.grid_spacing_percent / 100
        
        for i in range(-self.grid_levels // 2, self.grid_levels // 2 + 1):
            price = center_price + (i * spacing)
            grid.append({
                'price': price,
                'type': 'sell' if i > 0 else 'buy',
                'quantity': 0.1
            })
        
        return grid

# ============================================================================
# MARKET MAKING
# ============================================================================

class MarketMakerBot:
    """Market making bot"""

    def __init__(self, spread_percent: float = 0.001, inventory_skew: float = 0.0,
                 order_size: float = 0.1):
        if spread_percent <= 0:
            raise ValueError("spread_percent must be positive")
        if order_size <= 0:
            raise ValueError("order_size must be positive")
        self.spread_percent = spread_percent
        self.inventory_skew = inventory_skew
        self.order_size = order_size

    def quote(self, mid_price: float, inventory_position: float = 0.0) -> Tuple[Dict, Dict]:
        if mid_price <= 0:
            raise ValueError("mid_price must be positive")
        spread = mid_price * self.spread_percent

        # Skew quotes against inventory so the book leans toward flattening.
        skew_adjustment = inventory_position * self.inventory_skew

        bid_price = mid_price - spread - skew_adjustment
        ask_price = mid_price + spread - skew_adjustment
        if bid_price <= 0 or ask_price <= bid_price:
            raise ValueError("the quoted spread would produce a crossed or non-positive book")

        return (
            {'side': 'buy', 'price': round(bid_price, 2), 'size': self.order_size},
            {'side': 'sell', 'price': round(ask_price, 2), 'size': self.order_size}
        )

# ============================================================================
# ANALYTICS & REPORTING
# ============================================================================

class AnalyticsReporting:
    @staticmethod
    def generate_daily_report(date: str, volume: float, trades: int, revenue: float,
                              active_users: int, fees_collected: float,
                              maker_volume: float, taker_volume: float) -> Dict:
        # Every figure is passed in from the exchange's own ledgers. Nothing is
        # extrapolated: a maker/taker split or fee total is not derivable from
        # aggregate volume, so inventing one would misreport revenue.
        if abs((maker_volume + taker_volume) - volume) > max(1e-6, abs(volume) * 1e-6):
            raise ValueError("maker_volume + taker_volume must equal the reported volume")
        return {
            'date': date,
            'volume_24h': volume,
            'trades_24h': trades,
            'revenue_24h': revenue,
            'active_users': active_users,
            'fees_collected': fees_collected,
            'maker_volume': maker_volume,
            'taker_volume': taker_volume,
        }

    @staticmethod
    def generate_user_report(user_id: str, pnl: float, trades: int, volume: float,
                             winning_trades: int) -> Dict:
        if trades < 0 or winning_trades < 0 or winning_trades > trades:
            raise ValueError("winning_trades must be between 0 and trades")
        return {
            'user_id': user_id,
            'total_pnl': pnl,
            'total_trades': trades,
            'volume': volume,
            'win_rate': (winning_trades / trades) if trades else 0.0,
            'avg_trade_size': volume / trades if trades else 0,
        }

# ============================================================================
# MAIN
# ============================================================================

def _self_test() -> None:
    # A monotonically rising series: the fast average leads the slow one, so the
    # strategy opens a long and marks a profit. Asserted, not merely printed.
    prices = [100 + i * 0.5 for i in range(100)]
    engine = BacktestEngine(100000)
    result = engine.run(prices, StrategyTemplates.moving_average_crossover)
    assert result.total_trades >= 1, result
    assert result.total_pnl > 0, result
    assert result.winning_trades + result.losing_trades == result.total_trades
    assert 0.0 <= result.win_rate <= 1.0

    # Deterministic accounting: a long opened at 100 and closed at 90 loses,
    # a short opened at 100 and closed at 90 gains. The strategy is scripted so
    # the fills are known exactly.
    def scripted(signals):
        steps = iter(signals)

        def strategy(_prices, _position, _balance):
            return next(steps, 'hold')

        return strategy

    long_engine = BacktestEngine(100_000.0)
    long_result = long_engine.run([100.0, 90.0], scripted(['buy', 'close']))
    assert long_result.total_pnl < 0, long_result

    short_engine = BacktestEngine(100_000.0)
    short_result = short_engine.run([100.0, 90.0], scripted(['sell', 'close']))
    assert short_result.total_pnl > 0, short_result

    # RSI of a strictly rising series pins at 100.
    assert TechnicalIndicators.rsi(prices)[-1] == 100.0

    # The market maker must quote a positive, uncrossed book and skew with
    # inventory.
    mm = MarketMakerBot(spread_percent=0.001, inventory_skew=0.01, order_size=1.0)
    bid, ask = mm.quote(50_000.0, inventory_position=10.0)
    assert bid['price'] < ask['price'] and bid['price'] > 0
    skewed_bid, _ = mm.quote(50_000.0, inventory_position=-10.0)
    assert skewed_bid['price'] > bid['price']

    # Arbitrage only fires above the configured spread.
    arb = ArbitrageBot()
    arb.add_exchange('a', 100.0)
    arb.add_exchange('b', 100.1)
    assert arb.find_arbitrage() is None
    arb.add_exchange('b', 101.0)
    opportunity = arb.find_arbitrage()
    assert opportunity['buy_exchange'] == 'a' and opportunity['sell_exchange'] == 'b'

    # Grid levels are ordered and alternate sides around the centre.
    grid = GridTradingBot(grid_levels=10, grid_spacing_percent=1.0).generate_grid(100.0)
    assert len(grid) == 11
    assert grid[0]['type'] == 'buy' and grid[-1]['type'] == 'sell'
    assert grid[0]['price'] < 100.0 < grid[-1]['price']

    # Reporting fails closed on an inconsistent maker/taker split.
    try:
        AnalyticsReporting.generate_daily_report(
            '2024-01-01', 1000.0, 10, 1.0, 5, 1.0, 400.0, 500.0)
        raise AssertionError("inconsistent maker/taker split must be rejected")
    except ValueError:
        pass

    print("trading bots self-test passed")


if __name__ == "__main__":
    _self_test()
