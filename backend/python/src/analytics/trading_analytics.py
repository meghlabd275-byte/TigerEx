#!/usr/bin/env python3
"""
TigerEx Analytics Module - Python Implementation

Comprehensive analytics and trading analysis tools
Real-time metrics, backtesting, and performance tracking
"""

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
from datetime import datetime, timedelta
from enum import Enum
import json
import math

# ============================================================================
# TYPE DEFINITIONS
# ============================================================================

class OrderSide(Enum):
    BUY = "buy"
    SELL = "sell"

class OrderType(Enum):
    MARKET = "market"
    LIMIT = "limit"
    STOP = "stop"

@dataclass
class Trade:
    id: str
    symbol: str
    side: OrderSide
    order_type: OrderType
    price: float
    quantity: float
    fee: float
    timestamp: datetime

@dataclass
class Position:
    symbol: str
    quantity: float
    avg_entry_price: float
    current_price: float
    unrealized_pnl: float
    realized_pnl: float
    entry_time: datetime

# ============================================================================
# ANALYTICS ENGINE
# ============================================================================

class AnalyticsEngine:
    """Core analytics engine for trading metrics"""
    
    def __init__(self):
        self.trades: List[Trade] = []
        self.positions: Dict[str, Position] = {}
        
    # ---------------------------------------------------------------------
    # TRADE RECORDING
    # ---------------------------------------------------------------------
    
    def record_trade(self, trade: Trade) -> None:
        """Record a trade for analytics"""
        self.trades.append(trade)
        
        # Update position
        if trade.symbol not in self.positions:
            self.positions[trade.symbol] = Position(
                symbol=trade.symbol,
                quantity=0.0,
                avg_entry_price=0.0,
                current_price=trade.price,
                unrealized_pnl=0.0,
                realized_pnl=0.0,
                entry_time=trade.timestamp
            )
        
        pos = self.positions[trade.symbol]
        
        if trade.side == OrderSide.BUY:
            # Calculate new average entry price
            total_cost = (pos.quantity * pos.avg_entry_price) + (trade.quantity * trade.price)
            pos.quantity += trade.quantity
            if pos.quantity > 0:
                pos.avg_entry_price = total_cost / pos.quantity
        else:
            # Reduce position
            pos.realized_pnl += (trade.price - pos.avg_entry_price) * trade.quantity
            pos.quantity -= trade.quantity
            
            if pos.quantity <= 0:
                pos.quantity = 0
                pos.avg_entry_price = 0.0
    
    # ---------------------------------------------------------------------
    # PERFORMANCE METRICS
    # ---------------------------------------------------------------------
    
    def calculate_total_pnl(self) -> float:
        """Calculate total P&L"""
        total = 0.0
        for pos in self.positions.values():
            total += pos.realized_pnl + pos.unrealized_pnl
        return total
    
    def calculate_win_rate(self) -> float:
        """Calculate win rate percentage"""
        winning_trades = 0
        losing_trades = 0
        
        for pos in self.positions.values():
            if pos.realized_pnl > 0:
                winning_trades += 1
            elif pos.realized_pnl < 0:
                losing_trades += 1
        
        total = winning_trades + losing_trades
        if total == 0:
            return 0.0
        
        return (winning_trades / total) * 100
    
    def calculate_sharpe_ratio(self, risk_free_rate: float = 0.02) -> float:
        """Calculate Sharpe ratio"""
        if len(self.trades) < 2:
            return 0.0
        
        # Calculate returns
        returns = []
        for trade in self.trades:
            returns.append(trade.price * trade.quantity)
        
        # Calculate mean and std
        mean_return = sum(returns) / len(returns)
        
        variance = sum((r - mean_return) ** 2 for r in returns) / len(returns)
        std_return = math.sqrt(variance)
        
        if std_return == 0:
            return 0.0
        
        return (mean_return - risk_free_rate) / std_return
    
    def calculate_max_drawdown(self) -> float:
        """Calculate maximum drawdown percentage"""
        if not self.trades:
            return 0.0
        
        peak = float('-inf')
        max_dd = 0.0
        
        cumulative = 0.0
        
        for trade in self.trades:
            pnl = (trade.price - trade.avg_entry_price) * trade.quantity if hasattr(trade, 'avg_entry_price') else 0
            cumulative += pnl
            
            if cumulative > peak:
                peak = cumulative
            
            dd = (peak - cumulative) / peak if peak != 0 else 0
            max_dd = max(max_dd, dd)
        
        return max_dd * 100
    
    def calculate_profit_factor(self) -> float:
        """Calculate profit factor (gross profit / gross loss)"""
        gross_profit = 0.0
        gross_loss = 0.0
        
        for pos in self.positions.values():
            if pos.realized_pnl > 0:
                gross_profit += pos.realized_pnl
            else:
                gross_loss += abs(pos.realized_pnl)
        
        if gross_loss == 0:
            return float('inf') if gross_profit > 0 else 0.0
        
        return gross_profit / gross_loss
    
    # ---------------------------------------------------------------------
    # RISK METRICS
    # ---------------------------------------------------------------------
    
    def calculate_var(self, confidence: float = 0.95) -> float:
        """Calculate Value at Risk"""
        if not self.trades:
            return 0.0
        
        # Simple historical VaR
        returns = sorted([t.price for t in self.trades])
        
        index = int((1 - confidence) * len(returns))
        if index >= len(returns):
            index = len(returns) - 1
        
        return abs(returns[index])
    
    def calculate_position_size(self, 
                          account_size: float, 
                          risk_per_trade: float,
                          entry_price: float,
                          stop_loss: float) -> float:
        """Calculate position size based on risk"""
        if entry_price == 0 or stop_loss == 0:
            return 0.0
        
        price_risk = abs(entry_price - stop_loss) / entry_price
        if price_risk == 0:
            return 0.0
        
        position_value = (account_size * risk_per_trade) / price_risk
        return position_value / entry_price
    
    # ---------------------------------------------------------------------
    # PERFORMANCE REPORT
    # ---------------------------------------------------------------------
    
    def get_performance_summary(self) -> dict:
        """Get comprehensive performance summary"""
        total_pnl = self.calculate_total_pnl()
        win_rate = self.calculate_win_rate()
        sharpe = self.calculate_sharpe_ratio()
        max_dd = self.calculate_max_drawdown()
        profit_factor = self.calculate_profit_factor()
        
        return {
            "total_trades": len(self.trades),
            "open_positions": len(self.positions),
            "total_pnl": total_pnl,
            "win_rate": round(win_rate, 2),
            "sharpe_ratio": round(sharpe, 2),
            "max_drawdown": round(max_dd, 2),
            "profit_factor": round(profit_factor, 2),
        }
    
    # ---------------------------------------------------------------------
    # HOLDINGS
    # ---------------------------------------------------------------------
    
    def get_top_holdings(self, limit: int = 10) -> List[dict]:
        """Get top holdings by value"""
        holdings = []
        
        for symbol, pos in self.positions.items():
            value = pos.quantity * pos.current_price
            holdings.append({
                "symbol": symbol,
                "quantity": pos.quantity,
                "value": value,
                "unrealized_pnl": pos.unrealized_pnl,
            })
        
        # Sort by value
        holdings.sort(key=lambda x: x["value"], reverse=True)
        
        return holdings[:limit]


# ============================================================================
# BACKTESTING ENGINE
# ============================================================================

class BacktestEngine:
    """Backtesting engine for strategy testing"""
    
    def __init__(self, initial_capital: float = 10000.0):
        self.initial_capital = initial_capital
        self.capital = initial_capital
        self.trades: List[Trade] = []
        self.equity_curve: List[Tuple[datetime, float]] = []
        
    def run_backtest(self, 
                   strategy,
                   market_data: List[dict],
                   verbose: bool = False) -> dict:
        """Run backtest on market data"""
        # Reset state
        self.capital = self.initial_capital
        self.trades = []
        self.equity_curve = []
        
        # Run strategy over data
        for i, bar in enumerate(market_data[1:], 1):
            prev_bar = market_data[i-1]
            
            signal = strategy.generate_signal(prev_bar, bar)
            
            if signal == "buy":
                # Execute buy
                trade = Trade(
                    id=f"bt_{i}",
                    symbol=strategy.symbol,
                    side=OrderSide.BUY,
                    order_type=OrderType.LIMIT,
                    price=bar["close"],
                    quantity=strategy.position_size / bar["close"],
                    fee=0.001,
                    timestamp=bar.get("time", datetime.now())
                )
                self.trades.append(trade)
                self.capital -= trade.price * trade.quantity
                
            elif signal == "sell":
                # Execute sell
                trade = Trade(
                    id=f"bt_{i}",
                    symbol=strategy.symbol,
                    side=OrderSide.SELL,
                    order_type=OrderType.LIMIT,
                    price=bar["close"],
                    quantity=strategy.position_size / bar["close"],
                    fee=0.001,
                    timestamp=bar.get("time", datetime.now())
                )
                self.trades.append(trade)
                self.capital += trade.price * trade.quantity
            
            # Record equity
            current_equity = self.capital
            for t in self.trades:
                if t.side == OrderSide.SELL:
                    current_equity += t.price * t.quantity
            
            self.equity_curve.append((
                bar.get("time", datetime.now()),
                current_equity
            ))
        
        # Calculate metrics
        final_equity = self.equity_curve[-1][1] if self.equity_curve else self.initial_capital
        total_return = ((final_equity - self.initial_capital) / self.initial_capital) * 100
        
        return {
            "initial_capital": self.initial_capital,
            "final_equity": final_equity,
            "total_return": total_return,
            "total_trades": len(self.trades),
        }


# ============================================================================
# SCALPER STRATEGY EXAMPLE
# ============================================================================

class ScalperStrategy:
    """Example scalping strategy for backtesting"""
    
    def __init__(self, symbol: str, position_size: float):
        self.symbol = symbol
        self.position_size = position_size
        self.prev_ma = None
        
    def generate_signal(self, prev_bar: dict, curr_bar: dict) -> str:
        """Generate trading signal"""
        prev_close = prev_bar.get("close", 0)
        curr_close = curr_bar.get("close", 0)
        
        # Simple moving average cross
        if curr_close > prev_close * 1.01:
            return "buy"
        elif curr_close < prev_close * 0.99:
            return "sell"
        
        return "hold"


# ============================================================================
# MAIN EXAMPLE
# ============================================================================

def main():
    """Example usage"""
    
    # Create analytics engine
    analytics = AnalyticsEngine()
    
    # Simulate some trades
    now = datetime.now()
    
    trades_data = [
        Trade("1", "BTC/USDT", OrderSide.BUY, OrderType.MARKET, 50000, 0.1, 5, now - timedelta(hours=5)),
        Trade("2", "BTC/USDT", OrderSide.SELL, OrderType.MARKET, 51000, 0.05, 2.5, now - timedelta(hours=3)),
        Trade("3", "ETH/USDT", OrderSide.BUY, OrderType.MARKET, 3000, 1.0, 3, now - timedelta(hours=2)),
    ]
    
    for trade in trades_data:
        analytics.record_trade(trade)
    
    # Print performance summary
    summary = analytics.get_performance_summary()
    print("Performance Summary:")
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()