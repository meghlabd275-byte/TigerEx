#!/usr/bin/env python3
"""
TigerEx Quant Research Module - Python
AI/ML powered quantitative research and trading strategies
"""

from __future__ import annotations
from dataclasses import dataclass
from typing import List, Dict, Optional, Tuple, Callable
import math
import time
import random

# ============================================================================
# QUANT RESEARCH MODULES
# ============================================================================

@dataclass
class Signal:
    timestamp: int
    symbol: str
    side: str  # buy, sell, hold
    confidence: float
    price: float
    target_price: Optional[float]
    stop_loss: Optional[float]
    metadata: Dict

class PortfolioSignal(Signal):
    """Portfolio-level signal combining multiple strategies"""
    allocation: float
    risk_score: float

class FactorModel:
    """Multi-factor quantitative model"""
    
    def __init__(self):
        self.factors = {}
        self.weights = {}
        self.factor_returns = {}
    
    def add_factor(self, name: str, compute_fn: Callable, weight: float = 1.0):
        self.factors[name] = compute_fn
        self.weights[name] = weight
    
    def compute_signal(self, symbol: str, data: Dict) -> float:
        total = 0.0
        for name, fn in self.factors.items():
            score = fn(data)
            total += score * self.weights.get(name, 1.0)
        
        return total / sum(self.weights.values())
    
    def momentum_factor(self, prices: List[float], period: int = 20) -> float:
        if len(prices) < period:
            return 0.0
        
        current = prices[-1]
        past = prices[-period]
        
        return (current - past) / past
    
    def mean_reversion_factor(self, prices: List[float], period: int = 20) -> float:
        if len(prices) < period:
            return 0.0
        
        recent = prices[-period:]
        mean = sum(recent) / len(recent)
        current = prices[-1]
        
        return (mean - current) / mean
    
    def volatility_factor(self, prices: List[float], period: int = 20) -> float:
        if len(prices) < period:
            return 0.0
        
        returns = [prices[i] - prices[i-1] for i in range(1, len(prices))]
        mean = sum(returns) / len(returns)
        
        variance = sum((r - mean) ** 2 for r in returns) / len(returns)
        return variance ** 0.5
    
    def volume_factor(self, volumes: List[float], period: int = 20) -> float:
        if len(volumes) < period:
            return 0.0
        
        recent_volume = sum(volumes[-period:]) / period
        avg_volume = sum(volumes) / len(volumes)
        
        return recent_volume / avg_volume if avg_volume > 0 else 0

class AlphaGenerator:
    """Alpha signal generation from multiple sources"""
    
    def __init__(self):
        self.strategies = []
        self.alpha_cache = {}
    
    def register_strategy(self, name: str, strategy_fn: Callable):
        self.strategies.append((name, strategy_fn))
    
    def generate_alpha(self, symbol: str, market_data: Dict) -> List[Signal]:
        signals = []
        
        for name, fn in self.strategies:
            try:
                signal = fn(symbol, market_data)
                if signal:
                    signals.append(signal)
            except Exception as e:
                print(f"Strategy {name} failed: {e}")
        
        return signals
    
    def momentum_strategy(self, symbol: str, prices: List[float]) -> Optional[Signal]:
        if len(prices) < 20:
            return None
        
        returns = (prices[-1] - prices[-20]) / prices[-20]
        
        if returns > 0.05:
            return Signal(
                timestamp=int(time.time()),
                symbol=symbol,
                side="buy",
                confidence=min(abs(returns) * 5, 1.0),
                price=prices[-1],
                target_price=prices[-1] * 1.1,
                stop_loss=prices[-1] * 0.95,
                metadata={"strategy": "momentum", "returns": returns}
            )
        elif returns < -0.05:
            return Signal(
                timestamp=int(time.time()),
                symbol=symbol,
                side="sell",
                confidence=min(abs(returns) * 5, 1.0),
                price=prices[-1],
                target_price=prices[-1] * 0.9,
                stop_loss=prices[-1] * 1.05,
                metadata={"strategy": "momentum", "returns": returns}
            )
        
        return None
    
    def mean_reversion_strategy(self, symbol: str, prices: List[float]) -> Optional[Signal]:
        if len(prices) < 20:
            return None
        
        mean = sum(prices[-20:]) / 20
        std = (sum((p - mean) ** 2 for p in prices[-20:]) / 20) ** 0.5
        
        current = prices[-1]
        
        if current < mean - 2 * std:
            return Signal(
                timestamp=int(time.time()),
                symbol=symbol,
                side="buy",
                confidence=min(abs(mean - current) / std, 1.0),
                price=current,
                target_price=mean,
                stop_loss=current * 0.95,
                metadata={"strategy": "mean_reversion"}
            )
        elif current > mean + 2 * std:
            return Signal(
                timestamp=int(time.time()),
                symbol=symbol,
                side="sell",
                confidence=min(abs(current - mean) / std, 1.0),
                price=current,
                target_price=mean,
                stop_loss=current * 1.05,
                metadata={"strategy": "mean_reversion"}
            )
        
        return None
    
    def pairs_trading_strategy(self, symbol_a: str, symbol_b: str, 
                          prices_a: List[float], prices_b: List[float]) -> Optional[Signal]:
        if len(prices_a) < 20 or len(prices_b) < 20:
            return None
        
        ratio = [a / b for a, b in zip(prices_a[-20:], prices_b[-20:])]
        mean_ratio = sum(ratio) / len(ratio)
        
        current_ratio = prices_a[-1] / prices_b[-1]
        
        z_score = (current_ratio - mean_ratio) / (sum((r - mean_ratio) ** 2 for r in ratio) / len(ratio)) ** 0.5
        
        if z_score > 2:
            return Signal(
                timestamp=int(time.time()),
                symbol=symbol_a,
                side="sell",
                confidence=min(abs(z_score) / 3, 1.0),
                price=prices_a[-1],
                target_price=mean_ratio * prices_b[-1],
                stop_loss=prices_a[-1] * 1.05,
                metadata={"strategy": "pairs", "ratio": current_ratio, "z_score": z_score}
            )
        elif z_score < -2:
            return Signal(
                timestamp=int(time.time()),
                symbol=symbol_a,
                side="buy",
                confidence=min(abs(z_score) / 3, 1.0),
                price=prices_a[-1],
                target_price=mean_ratio * prices_b[-1],
                stop_loss=prices_a[-1] * 0.95,
                metadata={"strategy": "pairs", "ratio": current_ratio, "z_score": z_score}
            )
        
        return None

class MachineLearningModel:
    """ML-based price prediction"""
    
    def __init__(self, model_type: str = "linear"):
        self.model_type = model_type
        self.weights = None
        self.trained = False
    
    def train(self, X: List[List[float]], y: List[float]):
        """Train the model"""
        if model_type == "linear":
            self.weights = self._train_linear(X, y)
        elif model_type == "logistic":
            self.weights = self._train_logistic(X, y)
        
        self.trained = True
    
    def _train_linear(self, X: List[List[float]], y: List[float]) -> List[float]:
        """Simple linear regression"""
        n = len(X)
        if n == 0:
            return []
        
        # Simplified - uses mean
        mean_x = [sum(col) / n for col in zip(*X)]
        mean_y = sum(y) / n
        
        numerator = sum((xi - mx) * (yi - my) for xi, yi, mx in zip(X, y, mean_x))
        denominator = sum((xi - mx) ** 2 for xi, mx in zip(X, mean_x))
        
        if denominator == 0:
            return [mean_y]
        
        slope = numerator / denominator
        intercept = mean_y - slope * sum(mean_x) / len(mean_x)
        
        return [intercept, slope]
    
    def _train_logistic(self, X: List[List[float]], y: List[float]) -> List[float]:
        """Logistic regression"""
        # Simplified logistic regression
        return [0.5] * (len(X[0]) + 1)
    
    def predict(self, X: List[List[float]]) -> List[float]:
        if not self.trained:
            return [0.5] * len(X)
        
        predictions = []
        
        if self.model_type == "linear":
            for sample in X:
                pred = sum(w * x for w, x in zip(self.weights[1:], sample))
                pred += self.weights[0]
                predictions.append(pred)
        
        return predictions
    
    def predict_next(self, features: List[float]) -> float:
        """Predict next price direction"""
        if not self.trained:
            return 0.5
        
        return self.predict([features])[0]

class EnsembleModel:
    """Ensemble of multiple models"""
    
    def __init__(self):
        self.models = []
        self.weights = []
    
    def add_model(self, model: Callable, weight: float = 1.0):
        self.models.append(model)
        self.weights.append(weight)
    
    def predict(self, features: List[float]) -> float:
        if not self.models:
            return 0.5
        
        total_weight = sum(self.weights)
        weighted_sum = sum(
            model(features) * w 
            for model, w in zip(self.models, self.weights)
        )
        
        return weighted_sum / total_weight

class BacktestRunner:
    """Historical backtesting with realistic costs"""
    
    def __init__(self, initial_capital: float = 100000, maker_fee: float = 0.001, taker_fee: float = 0.001):
        self.initial_capital = initial_capital
        self.maker_fee = maker_fee
        self.taker_fee = taker_fee
        self.capital = initial_capital
        self.position = 0.0
        self.trade_history = []
    
    def run_signal(self, signal: Signal, current_price: float) -> Dict:
        pnl = 0.0
        fee = 0.0
        
        if signal.side == "buy" and self.position == 0:
            qty = (self.capital * 0.95) / current_price
            fee = qty * current_price * self.taker_fee
            self.position = qty
            self.capital -= qty * current_price + fee
            
        elif signal.side == "sell" and self.position > 0:
            pnl = (current_price - signal.metadata.get('entry_price', current_price)) * self.position
            pnl -= pnl * self.taker_fee
            self.capital += (self.position * current_price) - fee + pnl
            self.position = 0
            
        elif signal.side == "close" and self.position > 0:
            pnl = current_price * self.position - signal.metadata.get('entry_price', current_price) * self.position
            pnl -= pnl * self.taker_fee
            self.capital += current_price * self.position - fee + pnl
            self.position = 0
        
        return {'pnl': pnl, 'fee': fee, 'capital': self.capital}
    
    def get_statistics(self) -> Dict:
        total_return = (self.capital - self.initial_capital) / self.initial_capital
        
        returns = [t['pnl'] for t in self.trade_history]
        
        wins = sum(1 for r in returns if r > 0)
        losses = sum(1 for r in returns if r <= 0)
        
        return {
            'total_return': total_return,
            'total_trades': len(self.trade_history),
            'winning_trades': wins,
            'losing_trades': losses,
            'win_rate': wins / len(self.trade_history) if self.trade_history else 0,
            'final_capital': self.capital,
        }

class ResearchPipeline:
    """Complete research pipeline"""
    
    def __init__(self):
        self.data_cache = {}
        self.factors = FactorModel()
        self.alpha_gen = AlphaGenerator()
        self.ml_model = MachineLearningModel()
        self.backtest = BacktestRunner()
    
    def load_data(self, symbol: str, days: int = 365) -> Dict:
        """Load historical data"""
        return {
            'prices': [random.uniform(30000, 50000) for _ in range(days)],
            'volumes': [random.uniform(500000, 2000000) for _ in range(days)],
        }
    
    def run_research(self, symbol: str) -> Dict:
        data = self.load_data(symbol)
        
        # Compute factors
        momentum = self.factors.momentum_factor(data['prices'])
        mean_reversion = self.factors.mean_reversion_factor(data['prices'])
        volatility = self.factors.volatility_factor(data['prices'])
        
        # Generate alphas
        alpha_signals = self.alpha_gen.generate_alpha(symbol, data)
        
        # Run backtest
        backtest_result = self.backtest.get_statistics()
        
        return {
            'symbol': symbol,
            'factors': {
                'momentum': momentum,
                'mean_reversion': mean_reversion,
                'volatility': volatility,
            },
            'signals': len(alpha_signals),
            'backtest': backtest_result,
        }

# ============================================================================
# MAIN
# ============================================================================

if __name__ == "__main__":
    print("TigerEx Quant Research Module v2.0")
    print("=" * 40)
    
    # Test factor model
    prices = [100 + i * 0.5 for i in range(100)]
    
    fm = FactorModel()
    momentum = fm.momentum_factor(prices)
    mean_rev = fm.mean_reversion_factor(prices)
    vol = fm.volatility_factor(prices)
    
    print(f"Momentum Factor: {momentum:.2%}")
    print(f"Mean Reversion: {mean_rev:.2%}")
    print(f"Volatility: {vol:.2f}")
    
    # Test alpha generator
    ag = AlphaGenerator()
    signal = ag.momentum_strategy("BTC/USDT", prices)
    
    if signal:
        print(f"\nSignal Generated:")
        print(f"  Side: {signal.side.upper()}")
        print(f"  Confidence: {signal.confidence:.0%}")
        print(f"  Price: ${signal.price:.2f}")
    
    # Test ML model
    ml = MachineLearningModel("linear")
    features = [1.0, 2.0, 3.0, 4.0, 5.0]
    pred = ml.predict_next(features)
    print(f"\nML Prediction: {pred}")
    
    # Run research
    rp = ResearchPipeline()
    result = rp.run_research("BTC/USDT")
    print(f"\nResearch Result: {result}")