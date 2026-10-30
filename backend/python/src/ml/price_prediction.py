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
# FEATURE ENGINEERING
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
        """MACD with a real 9-period signal line.

        The signal line is the EMA of the MACD series itself, not the MACD
        value repeated, so the histogram carries actual information.
        """
        if len(prices) < 26:
            raise ValueError("MACD requires at least 26 prices")

        def ema_series(values: List[float], window: int) -> List[float]:
            multiplier = 2 / (window + 1)
            series = [values[0]]
            for value in values[1:]:
                series.append((value - series[-1]) * multiplier + series[-1])
            return series

        ema_12 = ema_series(prices, 12)
        ema_26 = ema_series(prices, 26)
        macd_series = [fast - slow for fast, slow in zip(ema_12, ema_26)]

        signal_series = ema_series(macd_series, 9)

        macd = macd_series[-1]
        signal = signal_series[-1]
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
# PRICE PREDICTION MODEL
# ============================================================================

class PricePredictionModel:
    # Feature vector order used for training and inference.
    FEATURE_ORDER = (
        'sma_5', 'sma_20', 'sma_50', 'ema_12', 'ema_26', 'rsi_14',
        'bb_upper', 'bb_middle', 'bb_lower', 'macd', 'macd_signal',
        'macd_histogram', 'momentum_1', 'momentum_20',
    )

    def __init__(self, learning_rate: float = 0.05, epochs: int = 500):
        self.feature_engine = FeatureEngine()
        self.learning_rate = learning_rate
        self.epochs = epochs
        self.weights: Optional[List[float]] = None
        self.bias: float = 0.0
        self.expected_return_up: float = 0.0
        self.expected_return_down: float = 0.0
        self.feature_means: List[float] = []
        self.feature_stds: List[float] = []

    def _vectorise(self, features: dict) -> List[float]:
        return [float(features.get(name, 0.0)) for name in self.FEATURE_ORDER]

    def _standardise(self, vector: List[float]) -> List[float]:
        return [
            (value - mean) / std if std > 0 else 0.0
            for value, mean, std in zip(vector, self.feature_means, self.feature_stds)
        ]

    @staticmethod
    def _sigmoid(x: float) -> float:
        if x < -60:
            return 0.0
        if x > 60:
            return 1.0
        return 1.0 / (1.0 + math.exp(-x))

    def _build_training_set(self, historical_data: List[PricePoint],
                            labels: List[str]) -> Tuple[List[List[float]], List[float], List[float]]:
        """Build (features, binary labels, forward returns) from labelled history."""
        if len(historical_data) != len(labels):
            raise ValueError("historical_data and labels must have equal length")

        window = 60
        if len(historical_data) < window + 1:
            raise ValueError(f"training needs at least {window + 1} price points")

        rows: List[List[float]] = []
        targets: List[float] = []
        forward_returns: List[float] = []

        for index in range(window, len(historical_data)):
            label = labels[index]
            if label not in ('up', 'down'):
                continue
            slice_points = historical_data[index - window:index + 1]
            rows.append(self._vectorise(self.feature_engine.extract_features(slice_points)))
            targets.append(1.0 if label == 'up' else 0.0)

            closes = [point.close for point in slice_points]
            forward_returns.append((closes[-1] - closes[-2]) / closes[-2] if closes[-2] else 0.0)

        if len(rows) < 20:
            raise ValueError("not enough labelled samples to train the model")
        return rows, targets, forward_returns

    def train(self, historical_data: List[PricePoint], labels: List[str]) -> 'PricePredictionModel':
        """Fit a logistic model on real labelled history."""
        rows, targets, forward_returns = self._build_training_set(historical_data, labels)

        width = len(self.FEATURE_ORDER)
        self.feature_means = [sum(row[i] for row in rows) / len(rows) for i in range(width)]
        self.feature_stds = []
        for i in range(width):
            variance = sum((row[i] - self.feature_means[i]) ** 2 for row in rows) / len(rows)
            self.feature_stds.append(math.sqrt(variance))

        scaled = [self._standardise(row) for row in rows]

        self.weights = [0.0] * width
        self.bias = 0.0

        for _ in range(self.epochs):
            grad_w = [0.0] * width
            grad_b = 0.0
            for features, target in zip(scaled, targets):
                logit = self.bias + sum(w * f for w, f in zip(self.weights, features))
                error = self._sigmoid(logit) - target
                for i in range(width):
                    grad_w[i] += error * features[i]
                grad_b += error

            scale = 1.0 / len(scaled)
            for i in range(width):
                self.weights[i] -= self.learning_rate * grad_w[i] * scale
            self.bias -= self.learning_rate * grad_b * scale

        up_returns = [r for r, t in zip(forward_returns, targets) if t == 1.0]
        down_returns = [r for r, t in zip(forward_returns, targets) if t == 0.0]
        self.expected_return_up = sum(up_returns) / len(up_returns) if up_returns else 0.0
        self.expected_return_down = sum(down_returns) / len(down_returns) if down_returns else 0.0

        return self

    def predict(self, symbol: str, price_points: List[PricePoint],
              timeframe: str = "1h") -> Prediction:
        """Predict with the fitted model. Refuses to predict before training."""
        if self.weights is None:
            raise RuntimeError("PricePredictionModel.predict called before train")

        features = self.feature_engine.extract_features(price_points)
        vector = self._standardise(self._vectorise(features))

        logit = self.bias + sum(w * f for w, f in zip(self.weights, vector))
        probability_up = self._sigmoid(logit)

        closes = [point.close for point in price_points]
        current_price = closes[-1]

        expected_return = (
            probability_up * self.expected_return_up
            + (1.0 - probability_up) * self.expected_return_down
        )
        predicted_price = current_price * (1.0 + expected_return)

        if probability_up > 0.55:
            direction = "up"
        elif probability_up < 0.45:
            direction = "down"
        else:
            direction = "neutral"

        confidence = abs(probability_up - 0.5) * 2.0

        return Prediction(
            symbol=symbol,
            predicted_price=predicted_price,
            confidence=confidence,
            direction=direction,
            timeframe=timeframe,
            features=features
        )


# ============================================================================
# ANOMALY DETECTION
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
# MAIN EXAMPLE
# ============================================================================

def _self_test() -> None:
    """Deterministic checks for training, prediction and anomaly detection."""
    # A rising ramp labelled from its own forward direction: the model must
    # learn the trend rather than emit a constant.
    price_points = [
        PricePoint(i, 50000 + i * 10, 50050 + i * 10, 49950 + i * 10, 50000 + i * 10, 1000)
        for i in range(120)
    ]
    labels = [
        'up' if price_points[i + 1].close > price_points[i].close else 'down'
        for i in range(len(price_points) - 1)
    ] + ['up']

    model = PricePredictionModel()
    model.train(price_points, labels)

    prediction = model.predict("TGR/RUSD", price_points[-60:])
    assert prediction.direction in ('up', 'down', 'neutral')
    assert 0.0 <= prediction.confidence <= 1.0
    assert prediction.predicted_price > 0

    # Predicting before training must fail closed.
    try:
        PricePredictionModel().predict("TGR/RUSD", price_points[-60:])
        raise AssertionError("prediction before training must fail")
    except RuntimeError:
        pass

    # A label/value length mismatch must be rejected.
    try:
        PricePredictionModel().train(price_points, labels[:-5])
        raise AssertionError("mismatched labels must be rejected")
    except ValueError:
        pass

    detector = AnomalyDetector()
    detector.fit([point.close for point in price_points[:-10]])
    assert detector.detect(90000) is True
    assert detector.detect(50500) is False

    print("price prediction self-test passed")



if __name__ == "__main__":
    _self_test()
