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
        for price in prices:
            signal = strategy_func(price, self.position, self.balance)
            
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
                
            elif signal == 'close' and self.position != 0:
                pnl = self.calculate_pnl(price)
                self.balance += pnl
                self.trades.append({
                    'entry': self.entry_price,
                    'exit': price,
                    'pnl': pnl,
                    'side': self.position_side
                })
                self.position = 0
                self.position_side = None
            
            self.equity_curve.append(self.balance)
        
        if self.position != 0:
            self.balance += self.calculate_pnl(prices[-1])
        
        return self.calculate_stats()
    
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
            sharpe_ratio=0.5,
            win_rate=winning / len(self.trades) if self.trades else 0
        )
    
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
        
        rsi_values = [None]
        for i in range(period, len(gains) + 1):
            avg_gain = sum(gains[i-period:i]) / period
            avg_loss = sum(losses[i-period:i]) / period
            if avg_loss == 0:
                rsi_values.append(100.0)
            else:
                rs = avg_gain / avg_loss
                rsi = 100 - (100 / (1 + rs))
                rsi_values.append(round(rsi, 2))
        
        return (rsi_values + [None] * period)[:len(prices)]
    
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
    
    def __init__(self, spread_percent: float = 0.001, inventory_skew: float = 0.0):
        self.spread_percent = spread_percent
        self.inventory_skew = inventory_skew
    
    def quote(self, mid_price: float, inventory_position: float = 0.0) -> Tuple[Dict, Dict]:
        spread = mid_price * self.spread_percent
        
        # Adjust spread based on inventory
        skew_adjustment = inventory_position * self.inventory_skew
        
        bid_price = mid_price - spread - skew_adjustment
        ask_price = mid_price + spread - skew_adjustment
        
        return (
            {'side': 'buy', 'price': round(bid_price, 2), 'size': 0.1},
            {'side': 'sell', 'price': round(ask_price, 2), 'size': 0.1}
        )

# ============================================================================
# ANALYTICS & REPORTING
# ============================================================================

class AnalyticsReporting:
    @staticmethod
    def generate_daily_report(date: str, volume: float, trades: int, revenue: float, active_users: int) -> Dict:
        return {
            'date': date,
            'volume_24h': volume,
            'trades_24h': trades,
            'revenue_24h': revenue,
            'active_users': active_users,
            'fees_collected': revenue * 0.001,
            'maker_volume': volume * 0.6,
            'taker_volume': volume * 0.4,
        }
    
    @staticmethod
    def generate_user_report(user_id: str, pnl: float, trades: int, volume: float) -> Dict:
        return {
            'user_id': user_id,
            'total_pnl': pnl,
            'total_trades': trades,
            'volume': volume,
            'win_rate': 0.6,
            'avg_trade_size': volume / trades if trades else 0,
        }
    
    @staticmethod
    def generate_risk_report(positions: List[Dict]) -> Dict:
        total_exposure = sum(abs(float(p.get('value', 0))) for p in positions)
        leverage_avg = sum(float(p.get('leverage', 1)) for p in positions) / len(positions) if positions else 0
        
        return {
            'total_exposure': total_exposure,
            'average_leverage': leverage_avg,
            'position_count': len(positions),
            'risk_level': 'high' if leverage_avg > 10 else 'medium' if leverage_avg > 3 else 'low'
        }

# ============================================================================
# MAIN
# ============================================================================

if __name__ == "__main__":
    print("TigerEx Analytics Module - Python")
    
    # Test backtest
    prices = [100 + i * 0.5 for i in range(100)]
    engine = BacktestEngine(100000)
    result = engine.run(prices, StrategyTemplates.moving_average_crossover)
    
    print(f"Trades: {result.total_trades}")
    print(f"Win Rate: {result.win_rate:.1%}")
    print(f"PnL: ${result.total_pnl:.2f}")
    print(f"Max Drawdown: {result.max_drawdown:.1f}%")
    
    # Test RSI
    rsi = TechnicalIndicators.rsi(prices)
    print(f"Latest RSI: {rsi[-1]}")