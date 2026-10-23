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
        """Train the model. Raises on unusable input instead of guessing."""
        if not X or not y or len(X) != len(y):
            raise ValueError("X and y must be non-empty and of equal length")
        if len(X[0]) == 0:
            raise ValueError("samples must contain at least one feature")

        if self.model_type == "linear":
            self.weights = self._train_linear(X, y)
        elif self.model_type == "logistic":
            self.weights = self._train_logistic(X, y)
        else:
            raise ValueError(f"unsupported model_type: {self.model_type}")

        self.trained = True

    def _train_linear(self, X: List[List[float]], y: List[float]) -> List[float]:
        """Ordinary least squares via the normal equations.

        Solves (X^T X) w = X^T y with Gaussian elimination and partial
        pivoting so multi-feature data is fitted correctly instead of
        collapsing to a single mean.
        """
        p = len(X[0])
        design = [[1.0] + [float(v) for v in row] for row in X]
        if any(len(row) != p + 1 for row in design):
            raise ValueError("all samples must have the same number of features")
        targets = [float(v) for v in y]

        size = p + 1
        a = [[0.0] * size for _ in range(size)]
        b = [0.0] * size
        for row, target in zip(design, targets):
            for i in range(size):
                b[i] += row[i] * target
                for j in range(size):
                    a[i][j] += row[i] * row[j]

        for col in range(size):
            pivot = max(range(col, size), key=lambda r: abs(a[r][col]))
            if abs(a[pivot][col]) < 1e-12:
                raise ValueError("training data is singular; cannot fit linear model")
            a[col], a[pivot] = a[pivot], a[col]
            b[col], b[pivot] = b[pivot], b[col]

            pivot_value = a[col][col]
            for j in range(col, size):
                a[col][j] /= pivot_value
            b[col] /= pivot_value

            for row in range(size):
                if row == col:
                    continue
                factor = a[row][col]
                if factor == 0.0:
                    continue
                for j in range(col, size):
                    a[row][j] -= factor * a[col][j]
                b[row] -= factor * b[col]

        return b

    def _train_logistic(self, X: List[List[float]], y: List[float]) -> List[float]:
        """Binary logistic regression trained with gradient descent."""
        n = len(X)
        p = len(X[0])
        if any(len(row) != p for row in X):
            raise ValueError("all samples must have the same number of features")

        weights = [0.0] * (p + 1)
        learning_rate = 0.1
        epochs = 2000
        l2 = 1e-4

        for _ in range(epochs):
            gradients = [0.0] * (p + 1)
            for row, target in zip(X, y):
                if target not in (0, 1, 0.0, 1.0):
                    raise ValueError("logistic regression requires binary labels in {0, 1}")
                z = weights[0] + sum(w * x for w, x in zip(weights[1:], row))
                prediction = 1.0 / (1.0 + math.exp(-max(-60.0, min(60.0, z))))
                error = prediction - float(target)
                gradients[0] += error
                for j in range(p):
                    gradients[j + 1] += error * row[j]

            for j in range(len(weights)):
                regularisation = l2 * weights[j] if j > 0 else 0.0
                weights[j] -= learning_rate * (gradients[j] / n + regularisation)

        return weights

    def predict(self, X: List[List[float]]) -> List[float]:
        if not self.trained:
            raise RuntimeError("model must be trained before predicting")
        if self.weights is None:
            raise RuntimeError("model has no trained weights")

        predictions = []
        for sample in X:
            z = self.weights[0] + sum(w * x for w, x in zip(self.weights[1:], sample))
            if self.model_type == "logistic":
                predictions.append(1.0 / (1.0 + math.exp(-max(-60.0, min(60.0, z)))))
            else:
                predictions.append(z)

        return predictions

    def predict_next(self, features: List[float]) -> float:
        """Predict the next value for a single sample."""
        if not self.trained:
            raise RuntimeError("model must be trained before predicting")
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
    
    def load_data(self, symbol: str, days: int = 365, source=None) -> Dict:
        """Load historical market data for research.

        Research must run on real observations. Callers supply a data source
        (for example the exchange market-data service) exposing
        ``fetch_history(symbol, days)``. Without one this fails closed rather
        than inventing prices.
        """
        if source is None:
            raise RuntimeError(
                "no market data source configured; refusing to synthesise history"
            )
        data = source.fetch_history(symbol, days)
        if not isinstance(data, dict):
            raise TypeError("market data source must return a mapping")

        prices = data.get('prices')
        volumes = data.get('volumes')
        if not prices or not volumes or len(prices) != len(volumes):
            raise ValueError("market data source returned inconsistent history")
        if any(not isinstance(price, (int, float)) or price <= 0 for price in prices):
            raise ValueError("market data source returned non-positive prices")

        return data

    def run_research(self, symbol: str, days: int = 365, source=None) -> Dict:
        data = self.load_data(symbol, days, source)
        
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

class _FixtureSource:
    """Deterministic data source used only by this module's self-test."""

    def fetch_history(self, symbol: str, days: int) -> Dict:
        prices = [100.0 + (index * 0.5) for index in range(days)]
        volumes = [1000.0 + (index * 10.0) for index in range(days)]
        return {'prices': prices, 'volumes': volumes}


def _self_test() -> None:
    """Exercises every component with explicit fixtures (no production data)."""
    source = _FixtureSource()
    prices = source.fetch_history("BTC/USDT", 100)['prices']

    factors = FactorModel()
    assert factors.momentum_factor(prices) > 0
    assert factors.mean_reversion_factor(prices) < 0
    # Volatility needs a series with non-constant returns; a linear ramp has none.
    varying = [100.0 + (index % 5) * 3.0 + index * 0.5 for index in range(60)]
    assert factors.volatility_factor(varying) > 0

    # Ordinary least squares must recover an exact linear relationship.
    model = MachineLearningModel("linear")
    features = [[float(index)] for index in range(10)]
    targets = [3.0 + 2.0 * row[0] for row in features]
    model.train(features, targets)
    prediction = model.predict_next([5.0])
    assert abs(prediction - 13.0) < 1e-6, prediction

    # Logistic regression must separate a linearly separable problem.
    classifier = MachineLearningModel("logistic")
    labels = [0.0 if row[0] < 5 else 1.0 for row in features]
    classifier.train(features, labels)
    assert classifier.predict_next([0.0]) < 0.5
    assert classifier.predict_next([9.0]) > 0.5

    # Untrained models and missing sources must fail closed.
    try:
        MachineLearningModel("linear").predict_next([1.0])
        raise AssertionError("untrained prediction must fail")
    except RuntimeError:
        pass
    try:
        ResearchPipeline().run_research("BTC/USDT")
        raise AssertionError("research without a data source must fail")
    except RuntimeError:
        pass

    # Research runs end to end against the fixture source.
    result = ResearchPipeline().run_research("BTC/USDT", 100, source)
    assert result['symbol'] == "BTC/USDT"
    assert set(result['factors']) == {'momentum', 'mean_reversion', 'volatility'}

    print("research self-test passed")


if __name__ == "__main__":
    _self_test()
