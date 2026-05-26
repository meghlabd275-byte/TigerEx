#!/usr/bin/env python3
"""TigerEx Analytics Module - Python-based market analytics, backtesting, and BI"""

from __future__ import annotations
from dataclasses import dataclass
from typing import List, Dict, Optional, Tuple
import time

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
                self.trades.append({'entry': self.entry_price, 'exit': price, 'pnl': pnl, 'side': self.position_side})
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
        max_dd = self.calculate_max_drawdown()
        
        return BacktestResult(
            total_trades=len(self.trades),
            winning_trades=winning,
            losing_trades=losing,
            total_pnl=total_pnl,
            max_drawdown=max_dd,
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

class MarketMakerBot:
    def __init__(self, spread_percent: float = 0.001):
        self.spread_percent = spread_percent
    
    def quote(self, mid_price: float) -> Tuple[Dict, Dict]:
        spread = mid_price * self.spread_percent
        return ({'side': 'buy', 'price': round(mid_price - spread, 2)}, 
                {'side': 'sell', 'price': round(mid_price + spread, 2)})

class AnalyticsReporting:
    @staticmethod
    def generate_daily_report(date: str, volume: float, trades: int, revenue: float, active_users: int) -> Dict:
        return {
            'date': date,
            'volume_24h': volume,
            'trades_24h': trades,
            'revenue_24h': revenue,
            'active_users': active_users,
        }

if __name__ == "__main__":
    print("TigerEx Analytics Module")
    prices = [100 + i * 0.5 for i in range(100)]
    engine = BacktestEngine(100000)
    result = engine.run(prices, StrategyTemplates.moving_average_crossover)
    print(f"Trades: {result.total_trades}, Win Rate: {result.win_rate:.1%}, PnL: ${result.total_pnl:.2f}")