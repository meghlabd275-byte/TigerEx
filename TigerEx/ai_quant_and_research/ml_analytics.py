#!/usr/bin/env python3
"""
TigerEx - Machine Learning Trading Analytics System
Python Implementation for AI-Powered Trading

Features:
- Real-time market analysis
- Pattern recognition
- Sentiment analysis
- Price prediction models
- Anomaly detection
- Portfolio optimization
- Risk scoring

WARNING: Development code. Not for production without validation.
"""

import numpy as np
importpandas as pd
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from enum import Enum
importjson
import hashlib
import threading
import time

try:
    from sklearn.ensemble import RandomForestRegressor, GradientBoostingClassifier
    from sklearn.preprocessing import MinMaxScaler, StandardScaler
    from sklearn.model_selection import train_test_split
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False
    print("Warning: scikit-learn not available, using basic implementations")


# ============================================================================
# MARKET DATA STRUCTURES
# ============================================================================

class TimeInterval(Enum):
    MINUTE_1 = "1m"
    MINUTE_5 = "5m"
    MINUTE_15 = "15m"
    MINUTE_60 = "1h"
    HOUR_4 = "4h"
    DAY_1 = "1d"
    WEEK_1 = "1w"


@dataclass
class OHLCV:
    """OHLCV Candlestick data"""
    timestamp: int  # milliseconds
    open: float
    high: float
    low: float
    close: float
    volume: float
    quote_volume: float = 0


@dataclass
class MarketTick:
    """Real-time market tick"""
    symbol: str
    price: float
    quantity: float
    bids: float  # best bid
    asks: float  # best ask
    timestamp: int


@dataclass
class TradeSignal:
    """Trading signal output"""
    symbol: str
    action: str  # buy/sell/hold
    confidence: float  # 0-1
    target_price: Optional[float]
    stop_loss: Optional[float]
    reason: str
    timestamp: int


# ============================================================================
# TECHNICAL INDICATORS
# ============================================================================

class TechnicalIndicators:
    """Technical analysis indicators"""
    
    @staticmethod
    def sma(prices: List[float], period: int) -> float:
        """Simple Moving Average"""
        if len(prices) < period:
            return sum(prices) / len(prices) if prices else 0
        return sum(prices[-period:]) / period
    
    @staticmethod
    def ema(prices: List[float], period: int) -> float:
        """Exponential Moving Average"""
        if len(prices) < period:
            return sum(prices) / len(prices) if prices else 0
        
        multiplier = 2 / (period + 1)
        ema = sum(prices[:period]) / period
        
        for price in prices[period:]:
            ema = (price - ema) * multiplier + ema
        
        return ema
    
    @staticmethod
    def rsi(prices: List[float], period: int = 14) -> float:
        """Relative Strength Index"""
        if len(prices) < period + 1:
            return 50
        
        gains = []
        losses = []
        
        for i in range(1, len(prices)):
            change = prices[i] - prices[i-1]
            if change > 0:
                gains.append(change)
                losses.append(0)
            else:
                gains.append(0)
                losses.append(abs(change))
        
        if len(gains) < period:
            return 50
        
        avg_gain = sum(gains[-period:]) / period
        avg_loss = sum(losses[-period:]) / period
        
        if avg_loss == 0:
            return 100
        
        rs = avg_gain / avg_loss
        rsi = 100 - (100 / (1 + rs))
        
        return rsi
    
    @staticmethod
    def macd(prices: List[float]) -> Tuple[float, float, float]:
        """MACD (12, 26, 9)"""
        if len(prices) < 26:
            return 0, 0, 0
        
        ema12 = TechnicalIndicators.ema(prices, 12)
        ema26 = TechnicalIndicators.ema(prices, 26)
        macd_line = ema12 - ema26
        signal_line = TechnicalIndicators.ema([macd_line] * 9, 9)  # simplified
        histogram = macd_line - signal_line
        
        return macd_line, signal_line, histogram
    
    @staticmethod
    def bollinger_bands(prices: List[float], period: int = 20) -> Tuple[float, float, float]:
        """Bollinger Bands"""
        if len(prices) < period:
            sma = sum(prices) / len(prices)
            return sma, sma, sma
        
        recent = prices[-period:]
        sma_val = sum(recent) / period
        
        variance = sum((p - sma_val) ** 2 for p in recent) / period
        std_dev = variance ** 0.5
        
        return sma_val, sma_val - 2 * std_dev, sma_val + 2 * std_dev
    
    @staticmethod
    def atr(highs: List[float], lows: List[float], closes: List[float], period: int = 14) -> float:
        """Average True Range"""
        if len(highs) < period + 1:
            return 0
        
        tr = []
        for i in range(1, len(highs)):
            high_low = highs[i] - lows[i]
            high_close = abs(highs[i] - closes[i-1])
            low_close = abs(lows[i] - closes[i-1])
            tr.append(max(high_low, high_close, low_close))
        
        return sum(tr[-period:]) / period
    
    @staticmethod
    def stochastic(highs: List[float], lows: List[float], closes: List[float], period: int = 14) -> Tuple[float, float]:
        """Stochastic Oscillator %K, %D"""
        if len(highs) < period:
            return 50, 50
        
        recent_high = max(highs[-period:])
        recent_low = min(lows[-period:])
        
        if recent_high == recent_low:
            return 50, 50
        
        k = 100 * (closes[-1] - recent_low) / (recent_high - recent_low)
        d = k  # Simplified
        
        return k, d
    
    @staticmethod
    def fibonacci_retracement(high: float, low: float) -> Dict[str, float]:
        """Fibonacci Retracement levels"""
        diff = high - low
        return {
            "0.0%": low,
            "23.6%": low + diff * 0.236,
            "38.2%": low + diff * 0.382,
            "50.0%": low + diff * 0.5,
            "61.8%": low + diff * 0.618,
            "78.6%": low + diff * 0.786,
            "100.0%": high,
        }


# ============================================================================
# PATTERN RECOGNITION
# ============================================================================

class PatternRecognition:
    """Chart pattern recognition"""
    
    @staticmethod
    def detect_double_top(prices: List[float], tolerance: float = 0.02) -> Optional[Dict]:
        """Detect double top/bottom pattern"""
        if len(prices) < 50:
            return None
        
        # Find significant peaks
        peaks = []
        for i in range(2, len(prices) - 2):
            if prices[i] > prices[i-1] and prices[i] > prices[i-2] and \
               prices[i] > prices[i+1] and prices[i] > prices[i+2]:
                peaks.append((i, prices[i]))
        
        if len(peaks) < 2:
            return None
        
        # Check for double top
        last_peak = peaks[-1]
        prev_peak = peaks[-2]
        
        if abs(last_peak[1] - prev_peak[1]) / prev_peak[1] < tolerance:
            return {
                "pattern": "double_top",
                "resistance": last_peak[1],
                "breakout": last_peak[1] > prev_peak[1],
            }
        
        return None
    
    @staticmethod
    def detect_head_shoulders(prices: List[float]) -> Optional[Dict]:
        """Detect head and shoulders pattern"""
        if len(prices) < 60:
            return None
        
        # Simplified detection
        window = prices[-30:]
        center = len(window) // 2
        
        # Find local max and min
        max_idx = window.index(max(window))
        
        if abs(max_idx - center) < 5:
            return {
                "pattern": "head_shoulders",
                "neckline": min(window[max_idx-10:max_idx+10]),
            }
        
        return None
    
    @staticmethod
    def detect_trend(prices: List[float], period: int = 20) -> str:
        """Detect overall trend"""
        if len(prices) < period:
            return "neutral"
        
        recent = prices[-period:]
        ma = sum(recent) / period
        
        if recent[-1] > ma * 1.05:
            return "uptrend"
        elif recent[-1] < ma * 0.95:
            return "downtrend"
        
        return "neutral"


# ============================================================================
# ANOMALY DETECTION
# ============================================================================

class AnomalyDetector:
    """Detect price anomalies"""
    
    def __init__(self, threshold: float = 3.0):
        self.threshold = threshold
        self.price_history = deque(maxlen=1000)
        self.mean = 0
        self.std = 0
    
    def update(self, price: float) -> bool:
        """Update with new price, return True if anomaly detected"""
        self.price_history.append(price)
        
        if len(self.price_history) < 30:
            return False
        
        self.mean = np.mean(self.price_history)
        self.std = np.std(self.price_history)
        
        if self.std == 0:
            return False
        
        z_score = abs(price - self.mean) / self.std
        
        return z_score > self.threshold
    
    def get_zscore(self, price: float) -> float:
        """Calculate z-score for price"""
        if self.std == 0:
            return 0
        return (price - self.mean) / self.std


# ============================================================================
# PRICE PREDICTION MODEL
# ============================================================================

class PricePredictionModel:
    """ML-based price prediction"""
    
    def __init__(self):
        self.model = None
        self.scaler = StandardScaler() if SKLEARN_AVAILABLE else None
        self.feature_names = [
            "rsi", "macd", "bb_upper", "bb_lower",
            "atr", "stoch_k", "volume_ratio", "price_momentum"
        ]
        self.is_trained = False
    
    def prepare_features(self, ohlcv_data: List[OHLCV]) -> np.ndarray:
        """Extract features from OHLCV data"""
        if len(ohlcv_data) < 30:
            return np.array([])
        
        prices = [c.close for c in ohlcv_data]
        highs = [c.high for c in ohlcv_data]
        lows = [c.low for c in ohlcv_data]
        volumes = [c.volume for c in ohlcv_data]
        
        features = []
        
        # RSI
        rsi = TechnicalIndicators.rsi(prices)
        features.append(rsi / 100)  # Normalize
        
        # MACD
        macd, signal, hist = TechnicalIndicators.macd(prices)
        features.append(hist / prices[-1])  # Normalize
        
        # Bollinger Bands
        bb_mid, bb_low, bb_high = TechnicalIndicators.bollinger_bands(prices)
        features.append((bb_high - prices[-1]) / prices[-1])
        features.append((prices[-1] - bb_low) / prices[-1])
        
        # ATR
        atr = TechnicalIndicators.atr(highs, lows, prices)
        features.append(atr / prices[-1])
        
        # Stochastic
        stoch_k, _ = TechnicalIndicators.stochastic(highs, lows, prices)
        features.append(stoch_k / 100)
        
        # Volume ratio
        av_vol = sum(volumes[-20:]) / 20
        features.append(volumes[-1] / av_vol if av_vol > 0 else 1)
        
        # Momentum
        momentum = (prices[-1] - prices[-10]) / prices[-10] if len(prices) >= 10 else 0
        features.append(momentum)
        
        return np.array(features).reshape(1, -1)
    
    def predict_next_price(self, ohlcv_data: List[OHLCV]) -> Optional[float]:
        """Predict next price movement"""
        features = self.prepare_features(ohlcv_data)
        
        if features.size == 0:
            return None
        
        # Simple prediction based on RSI
        prices = [c.close for c in ohlcv_data]
        rsi = TechnicalIndicators.rsi(prices)
        
        if rsi < 30:
            # Oversold - potential bounce
            return prices[-1] * 1.02
        elif rsi > 70:
            # Overbought - potential drop
            return prices[-1] * 0.98
        
        # Trend continuation
        trend = PatternRecognition.detect_trend(prices)
        if trend == "uptrend":
            return prices[-1] * 1.005
        elif trend == "downtrend":
            return prices[-1] * 0.995
        
        return prices[-1]


# ============================================================================
# RISK SCORING
# ============================================================================

class RiskScorer:
    """Calculate risk scores for positions/markets"""
    
    @staticmethod
    def calculate_portfolio_risk(positions: List[Dict], correlation_matrix: Dict) -> float:
        """Calculate portfolio VaR (Value at Risk) - simplified"""
        if not positions:
            return 0
        
        # Simple risk = sum of weighted exposures
        total_risk = 0
        for pos in positions:
            exposure = pos.get("value", 0)
            stop_distance = pos.get("stop_loss_distance", 0.05)
            total_risk += exposure * stop_distance
        
        # Adjust for correlation
        diversification_factor = 1.0 - (len(positions) * 0.05)
        adjusted_risk = total_risk * max(diversification_factor, 0.5)
        
        return adjusted_risk
    
    @staticmethod
    def calculate_position_risk(
        entry_price: float,
        stop_loss: float,
        position_size: float
    ) -> Dict:
        """Calculate position-level risk metrics"""
        risk_per_share = entry_price - stop_loss
        risk_amount = risk_per_share * position_size
        risk_percent = (risk_per_share / entry_price) * 100
        
        return {
            "risk_per_share": risk_per_share,
            "total_risk_amount": risk_amount,
            "risk_percent": risk_percent,
            "position_size_usd": entry_price * position_size,
        }


# ============================================================================
# PORTFOLIO OPTIMIZER
# ============================================================================

class PortfolioOptimizer:
    """Optimize portfolio allocation"""
    
    @staticmethod
    def equal_weight(assets: List[str], capital: float) -> Dict[str, float]:
        """Equal weight allocation"""
        if not assets:
            return {}
        
        weight = capital / len(assets)
        return {asset: weight for asset in assets}
    
    @staticmethod
    def risk_parity(returns: Dict[str, List[float]], risk_budget: float) -> Dict[str, float]:
        """Risk parity allocation"""
        if not returns:
            return {}
        
        volatilities = {}
        for asset, ret in returns.items():
            volatilities[asset] = np.std(ret) if len(ret) > 1 else 0.01
        
        total_vol = sum(volatilities.values())
        if total_vol == 0:
            return PortfolioOptimizer.equal_weight(list(returns.keys()), 1)
        
        allocations = {}
        for asset, vol in volatilities.items():
            # Inverse volatility weighting
            weight = (1 / vol) / (1 / total_vol)
            allocations[asset] = weight * risk_budget
        
        return allocations
    
    @staticmethod
    def momentum_weighting(
        prices: Dict[str, List[float]],
        lookback: int = 20
    ) -> Dict[str, float]:
        """Momentum-based weighting"""
        if not prices:
            return {}
        
        mom_scores = {}
        for asset, price_list in prices.items():
            if len(price_list) < lookback:
                mom_scores[asset] = 0
                continue
            
            recent = price_list[-lookback:]
            momentum = (recent[-1] - recent[0]) / recent[0]
            mom_scores[asset] = momentum
        
        # Rank and allocate
        sorted_assets = sorted(mom_scores.items(), key=lambda x: x[1], reverse=True)
        total_rank = sum(range(1, len(sorted_assets) + 1))
        
        allocations = {}
        for rank, (asset, _) in enumerate(sorted_assets):
            weight = (rank + 1) / total_rank
            allocations[asset] = weight
        
        return allocations


# ============================================================================
# ANALYTICS ENGINE
# ============================================================================

class AnalyticsEngine:
    """Main analytics engine coordinating all analyses"""
    
    def __init__(self):
        self.candles = {}  # symbol -> deque of OHLCV
        self.anomaly_detectors = {}  # symbol -> AnomalyDetector
        self.prediction_models = {}  # symbol -> model
        self.max_candles = 10000
    
    def add_candle(self, symbol: str, candle: OHLCV):
        """Add new candle data"""
        if symbol not in self.candles:
            self.candles[symbol] = deque(maxlen=self.max_candles)
            self.anomaly_detectors[symbol] = AnomalyDetector()
            self.prediction_models[symbol] = PricePredictionModel()
        
        self.candles[symbol].append(candle)
    
    def get_analysis(self, symbol: str) -> Dict:
        """Get comprehensive analysis for symbol"""
        if symbol not in self.candles:
            return {"error": "No data"}
        
        candles = list(self.candles[symbol])
        if len(candles) < 30:
            return {"error": "Insufficient data"}
        
        prices = [c.close for c in candles]
        highs = [c.high for c in candles]
        lows = [c.low for c in candles]
        
        # Technical indicators
        rsi = TechnicalIndicators.rsi(prices)
        macd, signal, hist = TechnicalIndicators.macd(prices)
        bb_mid, bb_low, bb_high = TechnicalIndicators.bollinger_bands(prices)
        atr = TechnicalIndicators.atr(highs, lows, prices)
        trend = PatternRecognition.detect_trend(prices)
        
        # Pattern detection
        pattern = PatternRecognition.detect_double_top(prices)
        
        # Anomaly check
        detector = self.anomaly_detectors[symbol]
        is_anomaly = detector.update(prices[-1])
        z_score = detector.get_zscore(prices[-1])
        
        # Prediction
        model = self.prediction_models[symbol]
        predicted = model.predict_next_price(candles)
        
        # Risk metrics
        last_price = prices[-1]
        risk_metrics = RiskScorer.calculate_position_risk(
            last_price, last_price * 0.95, 1.0
        )
        
        return {
            "symbol": symbol,
            "last_price": last_price,
            "indicators": {
                "rsi": rsi,
                "macd": macd,
                "macd_signal": signal,
                "macd_histogram": hist,
                "bb_upper": bb_high,
                "bb_middle": bb_mid,
                "bb_lower": bb_low,
                "atr": atr,
                "trend": trend,
            },
            "patterns": pattern,
            "anomalies": {
                "detected": is_anomaly,
                "z_score": z_score,
            },
            "prediction": {
                "next_price": predicted,
                "direction": "up" if predicted and predicted > last_price else "down" if predicted and predicted < last_price else "neutral",
            },
            "risk": risk_metrics,
        }
    
    def scan_all_markets(self) -> List[TradeSignal]:
        """Scan all tracked markets for signals"""
        signals = []
        
        for symbol in self.candles.keys():
            analysis = self.get_analysis(symbol)
            
            if "error" in analysis:
                continue
            
            # Generate signals based on indicators
            rsi = analysis["indicators"]["rsi"]
            trend = analysis["indicators"]["trend"]
            
            if rsi < 30:
                signals.append(TradeSignal(
                    symbol=symbol,
                    action="buy",
                    confidence=0.7,
                    target_price=None,
                    stop_loss=analysis["last_price"] * 0.95,
                    reason="RSI oversold",
                    timestamp=int(time.time() * 1000)
                ))
            elif rsi > 70:
                signals.append(TradeSignal(
                    symbol=symbol,
                    action="sell",
                    confidence=0.7,
                    target_price=None,
                    stop_loss=analysis["last_price"] * 1.05,
                    reason="RSI overbought",
                    timestamp=int(time.time() * 1000)
                ))
        
        return signals


# ============================================================================
# MAIN ENTRY POINT
# ============================================================================

def main():
    """Example usage"""
    print("TigerEx ML Analytics Engine v1.0")
    print("=" * 40)
    
    engine = AnalyticsEngine()
    
    # Generate sample data
    base_price = 50000
    for i in range(100):
        change = (np.random.random() - 0.5) * 1000
        price = base_price + change
        candle = OHLCV(
            timestamp=int(time.time() * 1000) + i * 60000,
            open=base_price,
            high=max(base_price, price),
            low=min(base_price, price),
            close=price,
            volume=np.random.random() * 100,
        )
        engine.add_candle("BTC/USDT", candle)
        base_price = price
    
    # Analyze
    print("\nAnalyzing BTC/USDT...\n")
    analysis = engine.get_analysis("BTC/USDT")
    
    print(f"Last Price: ${analysis['last_price']:.2f}")
    print(f"RSI: {analysis['indicators']['rsi']:.1f}")
    print(f"Trend: {analysis['indicators']['trend']}")
    print(f"Bollinger High: ${analysis['indicators']['bb_upper']:.2f}")
    print(f"Bollinger Low: ${analysis['indicators']['bb_lower']:.2f}")
    
    if analysis.get("prediction", {}).get("next_price"):
        print(f"\nPredicted: ${analysis['prediction']['next_price']:.2f} ({analysis['prediction']['direction']})")
    
    print(f"\nRisk: ${analysis['risk']['risk_per_share']:.2f} per share")
    
    # Scan for signals
    print("\nScanning for signals...")
    signals = engine.scan_all_markets()
    for sig in signals:
        print(f"  {sig.symbol}: {sig.action.upper()} ({sig.confidence:.0%} confidence) - {sig.reason}")
    
    print("\nAnalytics engine ready.")


if __name__ == "__main__":
    main()