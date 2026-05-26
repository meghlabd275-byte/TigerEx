"""
TigerEx Trading Bots Module
Migrated from TypeScript to Python for AI/ML trading strategies.
"""
import random
from enum import Enum
from typing import Dict, List, Optional
from dataclasses import dataclass
from datetime import datetime
import json


class BotStrategy(Enum):
    """Trading bot strategies"""
    GRID = "grid"
    DCA = "dca"
    MOMENTUM = "momentum"
    MEAN_REVERSION = "mean_reversion"
    TREND_FOLLOWING = "trend_following"
    SCALING = "scaling"


class BotStatus(Enum):
    """Bot status"""
    STOPPED = "stopped"
    RUNNING = "running"
    PAUSED = "paused"
    ERROR = "error"


@dataclass
class BotConfig:
    """Bot configuration"""
    strategy: BotStrategy
    pair: str
    amount: float
    interval_seconds: int
    stop_loss_percent: float
    take_profit_percent: float
    max_positions: int


@dataclass
class TradeSignal:
    """Trading signal"""
    action: str  # buy, sell, hold
    pair: str
    price: float
    amount: float
    confidence: float
    reason: str


@dataclass
class BotPosition:
    """Bot position"""
    id: str
    pair: str
    entry_price: float
    amount: float
    opened_at: int


class GridBot:
    """Grid trading bot"""
    
    def __init__(self, config: BotConfig):
        self.config = config
        self.positions: List[BotPosition] = []
        self.status = BotStatus.STOPPED
        self.grid_levels: List[float] = []
    
    def generate_grid(self, low: float, high: float, levels: int):
        """Generate grid levels"""
        step = (high - low) / levels
        self.grid_levels = [low + i * step for i in range(levels)]
    
    def should_buy(self, price: float) -> bool:
        """Check if should buy"""
        if price <= min(self.grid_levels):
            return True
        if len(self.positions) < self.config.max_positions:
            for level in self.grid_levels:
                if abs(price - level) < level * 0.001:  # 0.1% tolerance
                    return True
        return False
    
    def should_sell(self, price: float) -> bool:
        """Check if should sell"""
        for pos in self.positions:
            pnl = (price - pos.entry_price) / pos.entry_price * 100
            if pnl >= self.config.take_profit_percent:
                return True
            if pnl <= -self.config.stop_loss_percent:
                return True
        return False
    
    def execute_buy(self, price: float) -> BotPosition:
        """Execute buy order"""
        pos = BotPosition(
            id=f"pos_{datetime.now().timestamp()}",
            pair=self.config.pair,
            entry_price=price,
            amount=self.config.amount,
            opened_at=int(datetime.now().timestamp() * 1000)
        )
        self.positions.append(pos)
        return pos
    
    def execute_sell(self, position: BotPosition, price: float):
        """Execute sell order"""
        self.positions.remove(position)


class DCABot:
    """Dollar Cost Averaging bot"""
    
    def __init__(self, config: BotConfig):
        self.config = config
        self.positions: List[BotPosition] = []
        self.total_invested = 0.0
        self.status = BotStatus.STOPPED
    
    def calculate_position_size(self, current_price: float) -> float:
        """Calculate position size for DCA"""
        base = self.config.amount
        
        # Increase size as price drops
        max_drop = 0.2  # 20% drop max
        drop_factor = min(current_price / self.config.interval_seconds, max_drop) / max_drop
        
        return base * (1 + drop_factor * 2)
    
    def should_buy(self, price: float) -> bool:
        """Check if should buy (DCA on dips)"""
        if len(self.positions) >= self.config.max_positions:
            return False
        
        if not self.positions:
            return True
        
        # Buy if price is lower than average
        avg_price = sum(p.entry_price for p in self.positions) / len(self.positions)
        return price < avg_price * 0.95  # 5% dip threshold
    
    def should_sell(self, price: float) -> bool:
        """Check if should sell"""
        if not self.positions:
            return False
        
        avg_price = sum(p.entry_price for p in self.positions) / len(self.positions)
        pnl = (price - avg_price) / avg_price * 100
        
        return pnl >= self.config.take_profit_percent


class MomentumBot:
    """Momentum trading bot"""
    
    def __init__(self, config: BotConfig):
        self.config = config
        self.price_history: List[float] = []
        self.min_history = 20
        self.status = BotStatus.STOPPED
    
    def add_price(self, price: float):
        """Add price to history"""
        self.price_history.append(price)
        if len(self.price_history) > self.min_history * 2:
            self.price_history.pop(0)
    
    def calculate_momentum(self) -> float:
        """Calculate momentum indicator"""
        if len(self.price_history) < self.min_history:
            return 0.0
        
        recent = self.price_history[-self.min_history:]
        
        # Simple momentum: price change over period
        momentum = (recent[-1] - recent[0]) / recent[0] * 100
        return momentum
    
    def should_buy(self, price: float) -> bool:
        """Check if should buy"""
        self.add_price(price)
        momentum = self.calculate_momentum()
        
        # Buy on strong positive momentum
        return momentum > 2.0  # 2% momentum threshold
    
    def should_sell(self, price: float) -> bool:
        """Check if should sell"""
        momentum = self.calculate_momentum()
        
        # Sell on negative momentum
        return momentum < -1.0


class TradingBotFactory:
    """Factory for creating trading bots"""
    
    @staticmethod
    def create_bot(config: BotConfig):
        """Create a bot based on strategy"""
        strategies = {
            BotStrategy.GRID: GridBot,
            BotStrategy.DCA: DCABot,
            BotStrategy.MOMENTUM: MomentumBot,
        }
        
        bot_class = strategies.get(config.strategy, GridBot)
        return bot_class(config)


def analyze_signals(prices: List[Dict]) -> List[TradeSignal]:
    """Analyze and generate trade signals"""
    signals = []
    
    for pair_data in prices:
        pair = pair_data.get('pair', 'UNKNOWN')
        current_price = pair_data.get('price', 0)
        change_24h = pair_data.get('change_24h', 0)
        
        if change_24h > 5:
            signal = TradeSignal(
                action="sell",
                pair=pair,
                price=current_price,
                amount=0.01,
                confidence=min(abs(change_24h) / 10, 1.0),
                reason="Strong momentum"
            )
        elif change_24h < -5:
            signal = TradeSignal(
                action="buy",
                pair=pair,
                price=current_price,
                amount=0.01,
                confidence=min(abs(change_24h) / 10, 1.0),
                reason="Dip opportunity"
            )
        else:
            signal = TradeSignal(
                action="hold",
                pair=pair,
                price=current_price,
                amount=0,
                confidence=0.5,
                reason="Neutral"
            )
        
        signals.append(signal)
    
    return signals


def backtest_strategy(strategy: str, prices: List[float], initial_capital: float = 10000) -> dict:
    """Backtest a trading strategy"""
    capital = initial_capital
    position = 0.0
    
    buy_signals = 0
    sell_signals = 0
    
    for i, price in enumerate(prices):
        if i == 0:
            continue
        
        prev_price = prices[i-1]
        change = (price - prev_price) / prev_price
        
        # Simple strategy: Buy on 2% drop, Sell on 2% rise
        if change < -0.02 and capital > 0:
            buy_signals += 1
            # Buy for 10% of capital
            amount = capital * 0.1 / price
            position += amount
            capital -= amount * price
        
        elif change > 0.02 and position > 0:
            sell_signals += 1
            capital += position * price
            position = 0
    
    final_value = capital + position * prices[-1]
    pnl = final_value - initial_capital
    roi = (pnl / initial_capital) * 100
    
    return {
        'strategy': strategy,
        'initial_capital': initial_capital,
        'final_value': final_value,
        'pnl': pnl,
        'roi_percent': roi,
        'buy_signals': buy_signals,
        'sell_signals': sell_signals
    }


def main():
    """Demo runner"""
    print("TigerEx Trading Bots Module initialized")
    
    # Demo config
    config = BotConfig(
        strategy=BotStrategy.GRID,
        pair="BTC/USDT",
        amount=0.001,
        interval_seconds=600,
        stop_loss_percent=5.0,
        take_profit_percent=10.0,
        max_positions=5
    )
    
    # Create bot
    bot = TradingBotFactory.create_bot(config)
    print(f"Created {config.strategy.value} bot for {config.pair}")
    
    # Test signals
    prices = [
        {'pair': 'BTC/USDT', 'price': 65000, 'change_24h': -3.5},
        {'pair': 'ETH/USDT', 'price': 3500, 'change_24h': 2.1}
    ]
    signals = analyze_signals(prices)
    for s in signals:
        print(f"Signal: {s.action} {s.pair} @ ${s.price} ({s.reason})")


if __name__ == "__main__":
    main()