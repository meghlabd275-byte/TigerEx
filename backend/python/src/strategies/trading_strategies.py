"""
Trading Strategies Module
Migrated from TypeScript to Python for algorithmic trading.
"""

from dataclasses import dataclass
from typing import List, Dict, Optional
from enum import Enum
import time
import math


class StrategyType(Enum):
    TREND_FOLLOWING = "trend_following"
    MEAN_REVERSION = "mean_reversion"
    GRID_TRADING = "grid_trading"
    SCALPING = "scalping"
    ARBITRAGE = "arbitrage"
    DIVERSIFICATION = "diversification"


@dataclass
class Signal:
    """Trading signal"""
    strategy: str
    action: str  # buy, sell
    price: float
    quantity: float
    stop_loss: Optional[float]
    take_profit: Optional[float]
    confidence: float  # 0-1


@dataclass
class Position:
    """Trading position"""
    id: str
    symbol: str
    side: str  # long, short
    quantity: float
    entry_price: float
    current_price: float
    pnl: float


class GridStrategy:
    """Grid trading strategy"""
    
    def __init__(self, symbol: str, grid_levels: int = 10, grid_spacing: float = 0.01):
        self.symbol = symbol
        self.grid_levels = grid_levels
        self.grid_spacing = grid_spacing
        self.orders = []
    
    def generate_signals(self, prices: List[float], current_price: float) -> List[Signal]:
        signals = []
        
        # Calculate grid
        center_price = sum(prices) / len(prices)
        lower = center_price * (1 - self.grid_spacing * self.grid_levels / 2)
        upper = center_price * (1 + self.grid_spacing * self.grid_levels / 2)
        
        for level in range(self.grid_levels):
            grid_price = lower + (upper - lower) * level / self.grid_levels
            
            if current_price < grid_price:
                signals.append(Signal(
                    strategy="grid",
                    action="buy",
                    price=grid_price,
                    quantity=1.0,
                    stop_loss=None,
                    take_profit=grid_price * (1 + self.grid_spacing),
                    confidence=0.8
                ))
            elif current_price > grid_price:
                signals.append(Signal(
                    strategy="grid",
                    action="sell",
                    price=grid_price,
                    quantity=1.0,
                    stop_loss=None,
                    take_profit=grid_price * (1 - self.grid_spacing),
                    confidence=0.8
                ))
        
        return signals[:5]  # Limit orders


class TrendStrategy:
    """Trend following strategy"""
    
    def __init__(self, symbol: str, fast_ma: int = 20, slow_ma: int = 50):
        self.symbol = symbol
        self.fast_ma = fast_ma
        self.slow_ma = slow_ma
    
    def calculate_ma(self, prices: List[float], period: int) -> float:
        if len(prices) < period:
            return sum(prices) / len(prices) if prices else 0
        return sum(prices[-period:]) / period
    
    def generate_signals(self, prices: List[float], current_price: float) -> List[Signal]:
        if len(prices) < self.slow_ma:
            return []
        
        fast = self.calculate_ma(prices, self.fast_ma)
        slow = self.calculate_ma(prices, self.slow_ma)
        
        signals = []
        
        # Golden cross - bullish
        if fast > slow and fast / slow < 1.01:
            signals.append(Signal(
                strategy="trend",
                action="buy",
                price=current_price,
                quantity=1.0,
                stop_loss=current_price * 0.95,
                take_profit=current_price * 1.10,
                confidence=0.7
            ))
        
        # Death cross - bearish
        elif fast < slow and slow / fast < 1.01:
            signals.append(Signal(
                strategy="trend",
                action="sell",
                price=current_price,
                quantity=1.0,
                stop_loss=current_price * 1.05,
                take_profit=current_price * 0.90,
                confidence=0.7
            ))
        
        return signals


class ScalpStrategy:
    """Scalping strategy for small profits"""
    
    def __init__(self, symbol: str, target_profit: float = 0.0005):
        self.symbol = symbol
        self.target_profit = target_profit
    
    def generate_signals(self, prices: List[float], current_price: float) -> List[Signal]:
        if len(prices) < 20:
            return []
        
        # Calculate volatility
        recent = prices[-20:]
        volatility = (max(recent) - min(recent)) / current_price
        
        # Low volatility = scalping opportunity
        if volatility < 0.002:
            return [Signal(
                strategy="scalp",
                action="buy",
                price=current_price,
                quantity=0.5,
                stop_loss=current_price * 0.999,
                take_profit=current_price * (1 + self.target_profit),
                confidence=0.6
            )]
        
        return []


class ArbitrageStrategy:
    """Cross-exchange arbitrage"""
    
    def __init__(self):
        self.exchanges = {}  # exchange -> price
    
    def add_exchange_price(self, exchange: str, bid: float, ask: float):
        self.exchanges[exchange] = {"bid": bid, "ask": ask}
    
    def find_arbitrage(self) -> Optional[Dict]:
        if len(self.exchanges) < 2:
            return None
        
        for exc1, prices1 in self.exchanges.items():
            for exc2, prices2 in self.exchanges.items():
                if exc1 >= exc2:
                    continue
                
                # Buy low, sell high
                profit = prices1["ask"] - prices2["bid"]
                if profit > 0:
                    return {
                        "buy_exchange": exc2,
                        "sell_exchange": exc1,
                        "profit_percent": profit / prices1["ask"],
                        "action": "execute"
                    }
        
        return None


class StrategyManager:
    """Manages all trading strategies"""
    
    def __init__(self):
        self.strategies = {}
        self.active_positions = []
    
    def add_strategy(self, strategy_type: StrategyType, **params):
        name = strategy_type.value
        
        if strategy_type == StrategyType.TREND_FOLLOWING:
            self.strategies[name] = TrendStrategy(**params)
        elif strategy_type == StrategyType.GRID_TRADING:
            self.strategies[name] = GridStrategy(**params)
        elif strategy_type == StrategyType.SCALPING:
            self.strategies[name] = ScalpStrategy(**params)
    
    def execute_strategy(self, strategy_name: str, prices: List[float], current_price: float) -> List[Signal]:
        strategy = self.strategies.get(strategy_name)
        if not strategy:
            return []
        
        return strategy.generate_signals(prices, current_price)
    
    def run_all_strategies(self, prices: List[float], current_price: float) -> List[Signal]:
        all_signals = []
        
        for name, strategy in self.strategies.items():
            signals = strategy.generate_signals(prices, current_price)
            all_signals.extend(signals)
        
        # Sort by confidence
        all_signals.sort(key=lambda s: s.confidence, reverse=True)
        
        return all_signals[:3]


def main():
    print("Trading Strategies module initialized")
    
    # Initialize manager
    manager = StrategyManager()
    
    # Add strategies
    manager.add_strategy(StrategyType.TREND_FOLLOWING, symbol="BTCUSDT", fast_ma=20, slow_ma=50)
    manager.add_strategy(StrategyType.GRID_TRADING, symbol="BTCUSDT", grid_levels=10)
    manager.add_strategy(StrategyType.SCALPING, symbol="BTCUSDT")
    
    # Mock prices
    prices = [65000 + i * 100 for i in range(60)]
    current = 65500
    
    # Run strategies
    signals = manager.run_all_strategies(prices, current)
    
    print(f"\nGenerated {len(signals)} signals:")
    for s in signals:
        print(f"  {s.strategy}: {s.action} @ ${s.price}, qty={s.quantity}, conf={s.confidence:.0%}")


if __name__ == "__main__":
    main()