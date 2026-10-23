#!/usr/bin/env python3
"""
Advanced ML Models for TigerEx
Sentiment Analysis, Anomaly Detection, Portfolio Optimization
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Tuple
from collections import deque
import json

# ============== DATA STRUCTURES ==============

@dataclass
class MarketData:
    timestamp: int
    open: float
    high: float
    low: float
    close: float
    volume: float

@dataclass
class Signal:
    action: str  # buy, sell, hold
    strength: float  # 0-1
    target: Optional[float] = None
    stop_loss: Optional[float] = None
    metadata: Dict = None

# ============== TECHNICAL INDICATORS ==============

class TechnicalIndicators:
    """Technical analysis indicators"""
    
    @staticmethod
    def sma(prices: np.ndarray, period: int) -> np.ndarray:
        weights = np.ones(period) / period
        return np.convolve(prices, weights, mode='valid')
    
    @staticmethod
    def ema(prices: np.ndarray, period: int) -> np.ndarray:
        alpha = 2 / (period + 1)
        ema = np.zeros_like(prices)
        ema[0] = prices[0]
        for i in range(1, len(prices)):
            ema[i] = alpha * prices[i] + (1 - alpha) * ema[i-1]
        return ema
    
    @staticmethod
    def rsi(prices: np.ndarray, period: int = 14) -> np.ndarray:
        deltas = np.diff(prices)
        gains = np.where(deltas > 0, deltas, 0)
        losses = np.where(deltas < 0, -deltas, 0)
        
        avg_gain = TechnicalIndicators.sma(gains, period)
        avg_loss = TechnicalIndicators.sma(losses, period)
        
        rs = avg_gain / (avg_loss + 1e-10)
        rsi = 100 - (100 / (1 + rs))
        return rsi
    
    @staticmethod
    def macd(prices: np.ndarray, fast: int = 12, slow: int = 26, signal: int = 9) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        ema_fast = TechnicalIndicators.ema(prices, fast)
        ema_slow = TechnicalIndicators.ema(prices, slow)
        macd_line = ema_fast - ema_slow
        signal_line = TechnicalIndicators.ema(macd_line, signal)
        histogram = macd_line - signal_line
        return macd_line, signal_line, histogram
    
    @staticmethod
    def bollinger_bands(prices: np.ndarray, period: int = 20, std_dev: float = 2.0) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        sma = TechnicalIndicators.sma(prices, period)
        rolling_std = np.array([np.std(prices[i:i+period]) for i in range(len(prices) - period + 1)])
        
        upper = sma + (rolling_std * std_dev)
        lower = sma - (rolling_std * std_dev)
        return upper, sma, lower
    
    @staticmethod
    def atr(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int = 14) -> np.ndarray:
        tr = np.maximum(
            high[1:] - low[1:],
            np.maximum(
                np.abs(high[1:] - close[:-1]),
                np.abs(low[1:] - close[:-1])
            )
        )
        
        atr = np.zeros(len(tr))
        atr[0] = np.mean(tr[:period])
        for i in range(1, len(tr)):
            atr[i] = (atr[i-1] * (period - 1) + tr[i]) / period
        return atr


# ============== SENTIMENT ANALYZER ==============

class SentimentAnalyzer:
    """News and social media sentiment analysis"""
    
    KEYWORDS_BULLISH = [
        'bullish', 'buy', 'upgrade', 'beat', 'growth', 'surge', 'rally', 'gain',
        'profit', 'success', 'launch', 'partnership', 'adoption', 'innovation', 'partners',
        'announces', 'rising', 'positive', 'strong', 'bull', 'moon', 'hodl'
    ]
    
    KEYWORDS_BEARISH = [
        'bearish', 'sell', 'downgrade', 'miss', 'drop', 'crash', 'loss', 'fail',
        'lawsuit', 'investigation', 'hack', 'breach', 'scandal', 'bankruptcy',
        'delist', 'ban', 'warning', 'risk', 'volatile', 'dump', 'bear'
    ]
    
    def __init__(self):
        self.history = deque(maxlen=1000)
        
    def analyze_text(self, text: str) -> Dict[str, float]:
        text_lower = text.lower()
        
        bullish_count = sum(1 for kw in self.KEYWORDS_BULLISH if kw in text_lower)
        bearish_count = sum(1 for kw in self.KEYWORDS_BEARISH if kw in text_lower)
        
        total = bullish_count + bearish_count
        if total == 0:
            return {'score': 0.5, 'bullish': 0.5, 'bearish': 0.5, 'signal': 'neutral'}
        
        bullish_ratio = bullish_count / total
        bearish_ratio = bearish_count / total
        
        score = 0.5 + (bullish_ratio - bearish_ratio) * 0.5
        
        if score > 0.6:
            signal = 'bullish'
        elif score < 0.4:
            signal = 'bearish'
        else:
            signal = 'neutral'
            
        return {
            'score': score,
            'bullish': bullish_ratio,
            'bearish': bearish_ratio,
            'signal': signal
        }
    
    def analyze_batch(self, texts: List[str]) -> Dict:
        results = [self.analyze_text(t) for t in texts]
        
        avg_score = np.mean([r['score'] for r in results])
        
        return {
            'overall_sentiment': avg_score,
            'articles_analyzed': len(texts),
            'bullish_count': sum(1 for r in results if r['signal'] == 'bullish'),
            'bearish_count': sum(1 for r in results if r['signal'] == 'bearish'),
            'neutral_count': sum(1 for r in results if r['signal'] == 'neutral'),
        }


# ============== ANOMALY DETECTOR ==============

class AnomalyDetector:
    """Statistical anomaly detection for unusual market behavior"""
    
    def __init__(self, threshold: float = 3.0):
        self.threshold = threshold
        self.history = deque(maxlen=1000)
        
    def fit(self, data: np.ndarray) -> None:
        """Fit the baseline mean and standard deviation from observations."""
        data = np.asarray(data, dtype=float).ravel()
        if data.size == 0:
            raise ValueError("fit requires at least one observation")
        if not np.all(np.isfinite(data)):
            raise ValueError("observations must be finite")

        self.mean = float(np.mean(data))
        self.std = float(np.std(data))
        self.history.extend(float(value) for value in data)

    def detect(self, value: float) -> Tuple[bool, float]:
        if not hasattr(self, "mean"):
            raise RuntimeError("detector must be fitted before use")
        z_score = float(abs((value - self.mean) / (self.std + 1e-10)))
        return bool(z_score > self.threshold), z_score

    def rolling_anomaly_check(self, window: int = 20) -> List[int]:
        """Indexes of observations that are anomalous relative to a rolling window."""
        if window <= 0:
            raise ValueError("window must be positive")

        data = np.fromiter(self.history, dtype=float)
        if data.size <= window:
            return []

        anomalies = []
        for index in range(window, data.size):
            segment = data[index - window:index]
            mean = float(np.mean(segment))
            std = float(np.std(segment))
            z_score = abs((data[index] - mean) / (std + 1e-10))
            if z_score > self.threshold:
                anomalies.append(index)

        return anomalies


# ============== PORTFOLIO OPTIMIZER ==============

class PortfolioOptimizer:
    """Mean-variance portfolio optimization using Modern Portfolio Theory"""
    
    def __init__(self, risk_free_rate: float = 0.02):
        self.risk_free_rate = risk_free_rate
        
    def optimize(
        self,
        returns: np.ndarray,
        target_return: Optional[float] = None
    ) -> Dict:
        """Markowitz mean-variance optimisation.

        With no target return this returns the tangency (maximum Sharpe)
        portfolio. With a target return it returns the minimum-variance
        portfolio achieving at least that return. Weights are fully invested
        (they sum to one).
        """
        returns = np.asarray(returns, dtype=float)
        if returns.ndim != 2 or returns.shape[0] < 2 or returns.shape[1] < 1:
            raise ValueError("returns must be a 2-D array with at least two observations")

        n_assets = returns.shape[1]
        expected_returns = np.mean(returns, axis=0)
        cov_matrix = np.atleast_2d(np.cov(returns.T, ddof=1))

        if n_assets == 1:
            weights = np.array([1.0])
        elif target_return is None:
            # Tangency portfolio: w proportional to Sigma^-1 (mu - rf * 1).
            excess = expected_returns - self.risk_free_rate
            try:
                raw = np.linalg.solve(cov_matrix, excess)
            except np.linalg.LinAlgError as exc:
                raise ValueError("covariance matrix is singular") from exc
            total = raw.sum()
            if abs(total) < 1e-12:
                raise ValueError("no finite tangency portfolio for these returns")
            weights = raw / total
        else:
            # Minimum variance subject to 1^T w = 1 and mu^T w = target.
            try:
                inv_cov = np.linalg.inv(cov_matrix)
            except np.linalg.LinAlgError as exc:
                raise ValueError("covariance matrix is singular") from exc
            ones = np.ones(n_assets)
            a = ones @ inv_cov @ ones
            b = ones @ inv_cov @ expected_returns
            c = expected_returns @ inv_cov @ expected_returns
            determinant = a * c - b * b
            if abs(determinant) < 1e-18:
                raise ValueError("degenerate efficient frontier; cannot hit target return")
            lagrange1 = (c - b * target_return) / determinant
            lagrange2 = (a * target_return - b) / determinant
            weights = inv_cov @ (lagrange1 * ones + lagrange2 * expected_returns)

        port_return = float(np.dot(weights, expected_returns))
        port_variance = float(weights @ cov_matrix @ weights)
        port_volatility = port_variance ** 0.5 if port_variance > 0 else 0.0
        sharpe_ratio = (
            (port_return - self.risk_free_rate) / port_volatility
            if port_volatility > 0 else 0.0
        )

        return {
            'weights': weights.tolist(),
            'expected_return': port_return,
            'volatility': port_volatility,
            'sharpe_ratio': sharpe_ratio,
            'risk_free_rate': self.risk_free_rate,
        }

    def RiskParity(self, returns: np.ndarray) -> np.ndarray:
        """Risk parity allocation"""
        cov_matrix = np.cov(returns.T)
        volatilities = np.sqrt(np.diag(cov_matrix))
        
        # Inverse volatility weights
        inv_vol = 1 / volatilities
        weights = inv_vol / np.sum(inv_vol)
        
        return weights
    
    def MinimumVariance(self, returns: np.ndarray) -> np.ndarray:
        """Global minimum-variance portfolio: Sigma^-1 1 / (1^T Sigma^-1 1)."""
        returns = np.asarray(returns, dtype=float)
        if returns.ndim != 2 or returns.shape[0] < 2:
            raise ValueError("returns must be a 2-D array with at least two observations")

        cov_matrix = np.atleast_2d(np.cov(returns.T, ddof=1))
        try:
            inv_cov = np.linalg.inv(cov_matrix)
        except np.linalg.LinAlgError as exc:
            raise ValueError("covariance matrix is singular") from exc

        ones = np.ones(returns.shape[1])
        denominator = ones @ inv_cov @ ones
        if abs(denominator) < 1e-12:
            raise ValueError("cannot compute minimum-variance weights")

        return (inv_cov @ ones) / denominator

# ============== VOLATILITY FORECASTER ==============

class VolatilityForecaster:
    """GARCH(1,1) volatility forecasting.

    Parameters use variance targeting: the long-run variance is the sample
    variance of returns and ``omega = (1 - alpha - beta) * long_run_variance``.
    The conditional-variance recursion is then run over the observed returns so
    the forecast starts from the latest residual instead of a flat guess.
    """

    def __init__(self, omega: Optional[float] = None, alpha: float = 0.1, beta: float = 0.85):
        if alpha < 0 or beta < 0 or alpha + beta >= 1:
            raise ValueError("GARCH requires alpha >= 0, beta >= 0 and alpha + beta < 1")
        self.alpha = alpha
        self.beta = beta
        self._omega_override = omega
        self.omega: Optional[float] = None
        self.variance: Optional[float] = None
        self.last_variance: Optional[float] = None

    def fit(self, returns: np.ndarray) -> None:
        """Fit the model to a series of returns."""
        returns = np.asarray(returns, dtype=float).ravel()
        if returns.size < 2:
            raise ValueError("at least two observations are required to fit GARCH")
        if not np.all(np.isfinite(returns)):
            raise ValueError("returns must be finite")

        long_run = float(np.var(returns, ddof=1))
        if long_run <= 0:
            raise ValueError("returns have zero variance; cannot fit GARCH")

        self.omega = (
            float(self._omega_override)
            if self._omega_override is not None
            else (1.0 - self.alpha - self.beta) * long_run
        )
        self.variance = long_run

        conditional = long_run
        for value in returns:
            conditional = self.omega + self.alpha * (value ** 2) + self.beta * conditional
        self.last_variance = conditional

    def forecast(self, horizon: int = 1) -> np.ndarray:
        """Forecast volatility (standard deviation) for the next ``horizon`` steps."""
        if horizon <= 0:
            raise ValueError("horizon must be positive")
        if self.omega is None or self.last_variance is None:
            raise RuntimeError("model must be fitted before forecasting")

        variances = []
        conditional = self.last_variance
        for _ in range(horizon):
            conditional = self.omega + (self.alpha + self.beta) * conditional
            variances.append(conditional)

        return np.sqrt(np.maximum(variances, 0.0))


# ============== LIQUIDITY ANALYZER ==============

class LiquidityAnalyzer:
    """Analyze market liquidity and slippage estimation"""
    
    def __init__(self):
        self.order_book_history = deque(maxlen=100)
        
    def estimate_slippage(
        self,
        side: str,
        size: float,
        mid_price: float,
        depth_bids: List[Tuple[float, float]],
        depth_asks: List[Tuple[float, float]]
    ) -> Dict:
        """Estimate slippage for a given trade size"""
        
        levels = depth_bids if side == 'buy' else depth_asks
        remaining_size = size
        total_cost = 0.0
        
        for price, available_qty in levels:
            fill_qty = min(remaining_size, available_qty)
            total_cost += fill_qty * price
            remaining_size -= fill_qty
            
            if remaining_size <= 0:
                break
                
        if remaining_size > 0:
            # Will move to next price level
            return {
                'estimated_slippage': 0.05,  # Conservative 5%
                'will_move_market': True,
                'warning': 'Large size may impact market'
            }
        
        filled_avg_price = total_cost / size
        slippage = abs(filled_avg_price - mid_price) / mid_price
        
        return {
            'estimated_slippage': slippage,
            'will_move_market': slippage > 0.001,
            'average_fill_price': filled_avg_price,
        }


# ============== MAIN EXECUTABLE ==============

def _self_test() -> None:
    """Deterministic checks for every model (fixed fixtures, no randomness)."""
    rng = np.random.default_rng(12345)

    # Technical indicators on a known series.
    prices = np.linspace(100.0, 150.0, 120)
    indicators = TechnicalIndicators()
    sma = indicators.sma(prices, 20)
    assert abs(float(sma[-1]) - float(np.mean(prices[-20:]))) < 1e-9
    rsi = indicators.rsi(prices)
    # A monotonically rising series has no downside, so RSI saturates at 100.
    assert abs(float(rsi[-1]) - 100.0) < 1e-6, rsi[-1]
    macd, signal, hist = indicators.macd(prices)
    assert len(macd) == len(prices) == len(signal) == len(hist)
    assert np.allclose(hist, macd - signal)

    # Anomaly detector flags an extreme value and passes a normal one.
    detector = AnomalyDetector(threshold=3.0)
    detector.fit(rng.normal(0.0, 1.0, size=1000))
    assert detector.detect(10.0)[0] is True
    assert detector.detect(0.1)[0] is False

    # Portfolio optimisation: weights sum to one and beat equal weight.
    returns = rng.normal(0.001, 0.02, size=(500, 3))
    risk_free = 0.0
    optimizer = PortfolioOptimizer(risk_free_rate=risk_free)
    portfolio = optimizer.optimize(returns)
    assert abs(sum(portfolio['weights']) - 1.0) < 1e-9
    cov = np.cov(returns.T, ddof=1)
    equal = np.ones(3) / 3
    equal_sharpe = (float(equal @ returns.mean(axis=0)) - risk_free) / float(np.sqrt(equal @ cov @ equal))
    assert portfolio['sharpe_ratio'] > equal_sharpe, (portfolio['sharpe_ratio'], equal_sharpe)

    min_var = optimizer.MinimumVariance(returns)
    assert abs(float(min_var.sum()) - 1.0) < 1e-9
    assert float(min_var @ cov @ min_var) < float(equal @ cov @ equal)

    # GARCH forecasting requires fitting first and reverts to the long-run level.
    forecaster = VolatilityForecaster(alpha=0.1, beta=0.85)
    try:
        forecaster.forecast(1)
        raise AssertionError("unfitted GARCH forecast must fail")
    except RuntimeError:
        pass
    forecaster.fit(returns[:, 0])
    horizon = forecaster.forecast(5)
    assert len(horizon) == 5 and np.all(horizon > 0)
    assert abs(float(horizon[-1]) - forecaster.variance ** 0.5) < abs(float(horizon[0]) - forecaster.variance ** 0.5)

    print("advanced models self-test passed")


if __name__ == "__main__":
    _self_test()
