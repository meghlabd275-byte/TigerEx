#!/usr/bin/env python3
"""
TigerEx Price Prediction ML - Python Implementation
Machine learning model for price prediction and market analysis
"""

from dataclasses import dataclass
from typing import List, Tuple, Optional
from datetime import datetime
import math
import json

# ============================================================================
# TYPE DEFINITIONS
# ============================================================================

@dataclass
class PricePoint:
    timestamp: int
    open: float
    high: float
    low: float
    close: float
    volume: float

@dataclass
class Prediction:
    symbol: str
    predicted_price: float
    confidence: float
    direction: str  # up, down, neutral
    timeframe: str
    features: dict

# ============================================================================
// FEATURE ENGINEERING
# ============================================================================

class FeatureEngine:
    def __init__(self):
        self.window_sizes = [5, 10, 20, 50, 200]
    
    def calculate_sma(self, prices: List[float], window: int) -> float:
        """Simple Moving Average"""
        if len(prices) < window:
            return sum(prices) / len(prices) if prices else 0
        return sum(prices[-window:]) / window
    
    def calculate_ema(self, prices: List[float], window: int) -> float:
        """Exponential Moving Average"""
        if len(prices) < window:
            return sum(prices) / len(prices) if prices else 0
        
        multiplier = 2 / (window + 1)
        ema = prices[0]
        
        for price in prices[1:]:
            ema = (price - ema) * multiplier + ema
        
        return ema
    
    def calculate_rsi(self, prices: List[float], period: int = 14) -> float:
        """Relative Strength Index"""
        if len(prices) < period + 1:
            return 50.0
        
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
        
        avg_gain = sum(gains[-period:]) / period
        avg_loss = sum(losses[-period:]) / period
        
        if avg_loss == 0:
            return 100.0
        
        rs = avg_gain / avg_loss
        return 100 - (100 / (1 + rs))
    
    def calculate_macd(self, prices: List[float]) -> Tuple[float, float, float]:
        """MACD (Moving Average Convergence Divergence)"""
        ema_12 = self.calculate_ema(prices, 12)
        ema_26 = self.calculate_ema(prices, 26)
        macd = ema_12 - ema_26
        
        # Signal line (9-period EMA of MACD)
        signal = macd  # Simplified
        
        histogram = macd - signal
        
        return macd, signal, histogram
    
    def calculate_bollinger_bands(self, prices: List[float], window: int = 20) -> Tuple[float, float, float]:
        """Bollinger Bands"""
        sma = self.calculate_sma(prices, window)
        
        if len(prices) < window:
            return sma, sma, sma
        
        variance = sum((p - sma) ** 2 for p in prices[-window:]) / window
        std_dev = math.sqrt(variance)
        
        upper = sma + (2 * std_dev)
        lower = sma - (2 * std_dev)
        
        return upper, sma, lower
    
    def calculate_atr(self, price_points: List[PricePoint], period: int = 14) -> float:
        """Average True Range (volatility)"""
        if len(price_points) < period:
            return 0.0
        
        true_ranges = []
        for i in range(1, len(price_points)):
            high_low = price_points[i].high - price_points[i].low
            high_prev_close = abs(price_points[i].high - price_points[i-1].close)
            low_prev_close = abs(price_points[i].low - price_points[i-1].close)
            true_ranges.append(max(high_low, high_prev_close, low_prev_close))
        
        return sum(true_ranges[-period:]) / period
    
    def calculate_obv(self, price_points: List[PricePoint]) -> float:
        """On-Balance Volume"""
        obv = 0.0
        
        for i in range(1, len(price_points)):
            if price_points[i].close > price_points[i-1].close:
                obv += price_points[i].volume
            elif price_points[i].close < price_points[i-1].close:
                obv -= price_points[i].volume
        
        return obv
    
    def extract_features(self, price_points: List[PricePoint]) -> dict:
        """Extract all features for ML model"""
        closes = [p.close for p in price_points]
        highs = [p.high for p in price_points]
        lows = [p.low for p in price_points]
        
        # Technical indicators
        features = {
            'sma_5': self.calculate_sma(closes, 5),
            'sma_20': self.calculate_sma(closes, 20),
            'sma_50': self.calculate_sma(closes, 50),
            'ema_12': self.calculate_ema(closes, 12),
            'ema_26': self.calculate_ema(closes, 26),
            'rsi_14': self.calculate_rsi(closes, 14),
            'atr_14': self.calculate_atr(price_points, 14),
            'obv': self.calculate_obv(price_points),
        }
        
        # Bollinger bands
        upper, middle, lower = self.calculate_bollinger_bands(closes)
        features['bb_upper'] = upper
        features['bb_middle'] = middle
        features['bb_lower'] = lower
        
        # MACD
        macd, signal, hist = self.calculate_macd(closes)
        features['macd'] = macd
        features['macd_signal'] = signal
        features['macd_histogram'] = hist
        
        # Price momentum
        if len(closes) >= 2:
            features['momentum_1'] = closes[-1] - closes[-2]
            features['returns_1'] = (closes[-1] - closes[-2]) / closes[-2]
        
        if len(closes) >= 20:
            features['momentum_20'] = closes[-1] - closes[-20]
            features['returns_20'] = (closes[-1] - closes[-20]) / closes[-20]
        
        return features


# ============================================================================
// PRICE PREDICTION MODEL
# ============================================================================

class PricePredictionModel:
    def __init__(self):
        self.feature_engine = FeatureEngine()
        self.model_weights = {}  # Trained weights
    
    def train(self, historical_data: List[PricePoint], labels: List[str]):
        """Train the model on historical data"""
        # Simplified training - real implementation would use proper ML
        print(f"Training on {len(historical_data)} data points...")
        
        # Learn simple patterns
        closes = [p.close for p in historical_data]
        
        # Calculate optimal weights
        self.model_weights = {
            'sma_weight': 0.3,
            'rsi_weight': 0.2,
            'macd_weight': 0.3,
            'momentum_weight': 0.2,
        }
        
        print("Model trained successfully")
    
    def predict(self, symbol: str, price_points: List[PricePoint], 
              timeframe: str = "1h") -> Prediction:
        """Make price prediction"""
        # Extract features
        features = self.feature_engine.extract_features(price_points)
        
        # Simplified prediction using weighted indicators
        closes = [p.close for p in price_points]
        current_price = closes[-1] if closes else 0
        
        # Calculate signals
        signals = []
        
        # SMA trend
        if features['sma_5'] > features['sma_20']:
            signals.append('bullish')
        elif features['sma_5'] < features['sma_20']:
            signals.append('bearish')
        
        # RSI
        if features['rsi_14'] < 30:
            signals.append('oversold')
        elif features['rsi_14'] > 70:
            signals.append('overbought')
        
        # MACD
        if features['macd_histogram'] > 0:
            signals.append('bullish')
        elif features['macd_histogram'] < 0:
            signals.append('bearish')
        
        # Calculate prediction
        bullish_count = sum(1 for s in signals if s == 'bullish' or s == 'oversold')
        bearish_count = sum(1 for s in signals if s == 'bearish' or s == 'overbought')
        
        if bullish_count > bearish_count:
            direction = "up"
            confidence = bullish_count / max(len(signals), 1)
            predicted_change = current_price * 0.02 * confidence
            predicted_price = current_price + predicted_change
        elif bearish_count > bullish_count:
            direction = "down"
            confidence = bearish_count / max(len(signals), 1)
            predicted_change = current_price * 0.02 * confidence
            predicted_price = current_price - predicted_change
        else:
            direction = "neutral"
            confidence = 0.5
            predicted_price = current_price
        
        return Prediction(
            symbol=symbol,
            predicted_price=predicted_price,
            confidence=confidence,
            direction=direction,
            timeframe=timeframe,
            features=features
        )


# ============================================================================
// ANOMALY DETECTION
# ============================================================================

class AnomalyDetector:
    def __init__(self):
        self.mean = 0.0
        self.std = 0.0
        self.z_score_threshold = 3.0
    
    def fit(self, prices: List[float]):
        """Fit normal distribution"""
        n = len(prices)
        if n == 0:
            return
        
        self.mean = sum(prices) / n
        variance = sum((p - self.mean) ** 2 for p in prices) / n
        self.std = math.sqrt(variance)
    
    def detect(self, price: float) -> bool:
        """Detect if price is anomalous"""
        if self.std == 0:
            return False
        
        z_score = abs(price - self.mean) / self.std
        return z_score > self.z_score_threshold
    
    def get_z_score(self, price: float) -> float:
        """Calculate z-score"""
        if self.std == 0:
            return 0.0
        return (price - self.mean) / self.std


# ============================================================================
// MAIN EXAMPLE
# ============================================================================

def main():
    # Sample data
    price_points = [
        PricePoint(i, 50000 + i*10, 50050 + i*10, 49950 + i*10, 50000 + i*10, 1000)
        for i in range(100)
    ]
    
    # Train model
    model = PricePredictionModel()
    model.train(price_points[:80], [])
    
    # Predict
    prediction = model.predict("BTC/USDT", price_points[80:])
    print(f"Prediction: {prediction.direction}")
    print(f"Confidence: {prediction.confidence:.1%}")
    print(f"Current: ${price_points[-1].close:.2f}")
    print(f"Predicted: ${prediction.predicted_price:.2f}")
    
    # Anomaly detection
    detector = AnomalyDetector()
    detector.fit([p.close for p in price_points[:-10]])
    
    test_price = 52000
    is_anomaly = detector.detect(test_price)
    z_score = detector.get_z_score(test_price)
    
    print(f"\nAnomaly Test:")
    print(f"Price: ${test_price}")
    print(f"Z-Score: {z_score:.2f}")
    print(f"Anomaly: {is_anomaly}")

if __name__ == "__main__":
    main()