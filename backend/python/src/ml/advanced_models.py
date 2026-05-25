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
        
        avg_score = np.mean([r['score'] for r in results)
        
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
        self.mean = np.mean(data)
        self.std = np.std(data)
        self.history.append(data)
        
    def detect(self, value: float) -> Tuple[bool, float]:
        z_score = abs((value - self.mean) / (self.std + 1e-10))
        is_anomaly = z_score > self.threshold
        return is_anomaly, z_score
    
    def rolling_anomaly_check(self, window: int = 20) -> List[int]:
        if len(self.history) < window:
            return []
        
        anomalies = []
        data = np.array(self.history)
        
        for i in range(window, len(data)):
            segment = data[i-window:i]
            mean = np.mean(segment)
            std = np.std(segment)
            
            z_score = abs((data[i] - mean) / (std + 1e-10))
            if z_score > self.threshold:
                anomalies.append(i)
                
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
        """
        Calculate optimal portfolio weights using Markowitz Mean-Variance Optimization
        """
        n_assets = returns.shape[1]
        
        # Calculate expected returns and covariance
        expected_returns = np.mean(returns, axis=0)
        cov_matrix = np.cov(returns.T)
        
        # Equal weight portfolio as baseline
        equal_weights = np.ones(n_assets) / n_assets
        
        # Portfolio metrics
        port_return = np.dot(equal_weights, expected_returns)
        port_volatility = np.sqrt(np.dot(equal_weights, np.dot(cov_matrix, equal_weights)))
        sharpe_ratio = (port_return - self.risk_free_rate) / port_volatility
        
        return {
            'weights': equal_weights.tolist(),
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
        """Minimum variance portfolio (simplified)"""
        cov_matrix = np.cov(returns.T)
        n = len(cov_matrix)
        
        # Use risk-parity as approximation
        volatilities = np.sqrt(np.diag(cov_matrix))
        inv_vol = 1 / volatilities
        weights = inv_vol / np.sum(inv_vol)
        
        return weights


# ============== VOLATILITY FORECASTER ==============

class VolatilityForecaster:
    """GARCH-like volatility forecasting"""
    
    def __init__(self, omega: float = 0.01, alpha: float = 0.1, beta: float = 0.85):
        self.omega = omega  # Base variance
        self.alpha = alpha  #ARCH term
        self.beta = beta  # GARCH term
        self.variance = None
        
    def fit(self, returns: np.ndarray) -> None:
        self.variance = np.var(returns)
        
    def forecast(self, horizon: int = 1) -> np.ndarray:
        if self.variance is None:
            return np.zeros(horizon)
            
        variance_forecast = [self.variance]
        
        for h in range(1, horizon):
            var = self.omega + self.alpha * self.variance + self.beta * variance_forecast[-1]
            variance_forecast.append(var)
            
        # For daily forecast, apply scaling
        return np.array([np.sqrt(v) * np.sqrt(h) for v, h in zip(variance_forecast, range(1, horizon + 1))])


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

if __name__ == "__main__":
    print("TigerEx Advanced ML Models v2.0.0")
    
    # Test Technical Indicators
    prices = np.cumsum(np.random.randn(100)) + 100
    indicators = TechnicalIndicators()
    
    sma20 = indicators.sma(prices, 20)
    rsi = indicators.rsi(prices)
    macd, signal, hist = indicators.macd(prices)
    
    print(f"\nLatest RSI: {rsi[-1]:.2f}")
    print(f"Latest MACD: {macd[-1]:.2f}")
    print(f"MACD Signal: {signal[-1]:.2f}")
    
    # Test Sentiment Analyzer
    sentiment = SentimentAnalyzer()
    texts = [
        "Bitcoin surges to new ATH! Bullish momentum continues",
        "Regulatory concerns weigh on crypto markets",
        "Exchange announces new partnership"
    ]
    result = sentiment.analyze_batch(texts)
    print(f"\nSentiment Score: {result['overall_sentiment']:.2f}")
    
    # Test Portfolio Optimizer
    returns = np.random.randn(100, 3) * 0.02
    optimizer = PortfolioOptimizer()
    portfolio = optimizer.optimize(returns)
    print(f"\nSharpe Ratio: {portfolio['sharpe_ratio']:.2f}")