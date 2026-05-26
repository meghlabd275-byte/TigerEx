"""
Machine Learning Module for Trading Predictions
Migrated from TypeScript to Python for ML/AI analytics.
"""
import numpy as np
from dataclasses import dataclass
from typing import List, Dict, Optional, Tuple
from datetime import datetime
import json
import math


@dataclass
class PricePoint:
    """OHLCV data point"""
    timestamp: int
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass
class Prediction:
    """Prediction result"""
    direction: str  # up, down, flat
    confidence: float  # 0-1
    target_price: float
    timeframe: str


class MovingAverage:
    """Moving Average indicators"""
    
    @staticmethod
    def sma(prices: List[float], period: int) -> float:
        """Simple Moving Average"""
        if len(prices) < period:
            return 0.0
        return sum(prices[-period:]) / period
    
    @staticmethod
    def ema(prices: List[float], period: int) -> float:
        """Exponential Moving Average"""
        if len(prices) < period:
            return 0.0
        
        multiplier = 2.0 / (period + 1)
        ema = prices[0]
        
        for price in prices[1:]:
            ema = (price - ema) * multiplier + ema
        
        return ema
    
    @staticmethod
    def moving_average_convergence_divergence(
        prices: List[float], 
        fast: int = 12, 
        slow: int = 26
    ) -> float:
        """MACD"""
        fast_ema = MovingAverage.ema(prices, fast)
        slow_ema = MovingAverage.ema(prices, slow)
        return fast_ema - slow_ema


class RSI:
    """Relative Strength Index"""
    
    @staticmethod
    def calculate(prices: List[float], period: int = 14) -> float:
        """Calculate RSI"""
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
        rsi = 100.0 - (100.0 / (1.0 + rs))
        
        return rsi


class BollingerBands:
    """Bollinger Bands indicator"""
    
    @staticmethod
    def calculate(prices: List[float], period: int = 20, std_dev: float = 2.0):
        """Calculate upper, middle, lower bands"""
        if len(prices) < period:
            return 0.0, 0.0, 0.0
        
        sma = sum(prices[-period:]) / period
        
        variance = sum((p - sma) ** 2 for p in prices[-period:]) / period
        std = math.sqrt(variance)
        
        upper = sma + (std_dev * std)
        lower = sma - (std_dev * std)
        
        return upper, sma, lower


class VolumeProfile:
    """Volume Profile analysis"""
    
    @staticmethod
    def analyze(points: List[PricePoint], bins: int = 20) -> Dict:
        """Analyze volume by price level"""
        if not points:
            return {}
        
        min_price = min(p.low for p in points)
        max_price = max(p.high for p in points)
        
        if max_price == min_price:
            return {"error": "no range"}
        
        bin_size = (max_price - min_price) / bins
        volume_bins = {i: 0.0 for i in range(bins)}
        
        for p in points:
            typical = (p.high + p.low + p.close) / 3
            bin_idx = min(int((typical - min_price) / bin_size), bins - 1)
            volume_bins[bin_idx] += p.volume
        
        max_bin_idx = max(volume_bins, key=volume_bins.get)
        poc = min_price + (max_bin_idx * bin_size)  # Point of Control
        
        return {
            "poc": poc,
            "bins": volume_bins,
            "total_volume": sum(volume_bins.values())
        }


class MomentumStrategy:
    """Momentum-based trading strategy"""
    
    def __init__(self, rsi_threshold: float = 30, reversal_threshold: float = 70):
        self.rsi_threshold = rsi_threshold
        self.reversal_threshold = reversal_threshold
    
    def predict(self, prices: List[float]) -> Prediction:
        """Predict next price movement"""
        rsi = RSI.calculate(prices)
        
        if rsi < self.rsi_threshold:
            return Prediction(
                direction="up",
                confidence=min((self.rsi_threshold - rsi) / self.rsi_threshold, 1.0),
                target_price=prices[-1] * 1.02,
                timeframe="1h"
            )
        elif rsi > self.reversal_threshold:
            return Prediction(
                direction="down",
                confidence=min((rsi - self.reversal_threshold) / self.reversal_threshold, 1.0),
                target_price=prices[-1] * 0.98,
                timeframe="1h"
            )
        
        return Prediction(
            direction="flat",
            confidence=0.3,
            target_price=prices[-1],
            timeframe="1h"
        )


class MeanReversionStrategy:
    """Mean reversion strategy"""
    
    def __init__(self, lookback: int = 20, threshold: float = 2.0):
        self.lookback = lookback
        self.threshold = threshold
    
    def predict(self, prices: List[float]) -> Prediction:
        """Predict using mean reversion"""
        if len(prices) < self.lookback:
            return Prediction("flat", 0.0, prices[-1] if prices else 0, "1h")
        
        recent = prices[-self.lookback:]
        mean = sum(recent) / len(recent)
        std = math.sqrt(sum((p - mean) ** 2 for p in recent) / len(recent))
        
        z_score = (prices[-1] - mean) / std if std > 0 else 0
        
        if abs(z_score) > self.threshold:
            direction = "up" if z_score < 0 else "down"
            confidence = min(abs(z_score) / self.threshold, 1.0)
            target = mean  # Reversion target
        else:
            direction = "flat"
            confidence = 0.3
            target = prices[-1]
        
        return Prediction(direction, confidence, target, "1h")


class PatternRecognition:
    """Chart pattern recognition"""
    
    @staticmethod
    def detect_double_bottom(prices: List[float]) -> bool:
        """Detect double bottom pattern"""
        if len(prices) < 50:
            return False
        
        recent = prices[-50:]
        
        # Find two lows
        lows = []
        for i in range(10, len(recent) - 10):
            if (recent[i] < recent[i-1] and recent[i] < recent[i+1]):
                lows.append((i, recent[i]))
        
        if len(lows) < 2:
            return False
        
        # Check if two lows similar (within 2%)
        for i in range(len(lows) - 1):
            idx1, low1 = lows[i]
            for j in range(i+1, len(lows)):
                idx2, low2 = lows[j]
                if abs(low1 - low2) / low1 < 0.02:
                    # Check if price went up between lows
                    if max(recent[idx1:idx2]) > low1 * 1.05:
                        return True
        
        return False
    
    @staticmethod
    def detect_head_and_shoulders(prices: List[float]) -> bool:
        """Detect head and shoulders pattern"""
        if len(prices) < 60:
            return False
        
        recent = prices[-60:]
        
        # Find peaks
        peaks = []
        for i in range(10, len(recent) - 10):
            if (recent[i] > recent[i-1] and recent[i] > recent[i+1]):
                peaks.append((i, recent[i]))
        
        if len(peaks) < 3:
            return False
        
        # Head should be highest, shoulders similar and lower
        head = max(peaks, key=lambda x: x[1])
        shoulders = [p for p in peaks if p != head]
        
        if len(shoulders) >= 2:
            left, right = shoulders[0], shoulders[-1]
            avg_shoulder = (left[1] + right[1]) / 2
            
            if head[1] > avg_shoulder * 1.05:  # Head 5% higher
                if abs(left[1] - right[1]) / avg_shoulder < 0.03:  # Similar height
                    return True
        
        return False


def calculate_all_indicators(prices: List[float]) -> dict:
    """Calculate all indicators for a price series"""
    indicators = {}
    
    # Moving averages
    indicators['sma_20'] = MovingAverage.sma(prices, 20)
    indicators['sma_50'] = MovingAverage.sma(prices, 50)
    indicators['ema_12'] = MovingAverage.ema(prices, 12)
    indicators['ema_26'] = MovingAverage.ema(prices, 26)
    indicators['macd'] = MovingAverage.moving_average_convergence_divergence(prices)
    
    # RSI
    indicators['rsi'] = RSI.calculate(prices)
    
    # Bollinger Bands
    upper, middle, lower = BollingerBands.calculate(prices)
    indicators['bb_upper'] = upper
    indicators['bb_middle'] = middle
    indicators['bb_lower'] = lower
    
    return indicators


def main():
    """Demo"""
    print("ML Trading Module initialized")
    
    # Generate sample prices
    prices = [100 + i + (i % 10) * 0.5 for i in range(100)]
    
    # Calculate indicators
    indicators = calculate_all_indicators(prices)
    print(f"RSI: {indicators['rsi']:.2f}")
    print(f"MACD: {indicators['macd']:.2f}")
    print(f"Bollinger: U={indicators['bb_upper']:.2f} M={indicators['bb_middle']:.2f} L={indicators['bb_lower']:.2f}")
    
    # Predict
    momentum = MomentumStrategy()
    pred = momentum.predict(prices)
    print(f"Prediction: {pred.direction} ({pred.confidence:.2%}) -> ${pred.target_price:.2f}")
    
    # Pattern detection
    print(f"Double bottom: {PatternRecognition.detect_double_bottom(prices)}")
    print(f"H&S: {PatternRecognition.detect_head_and_shoulders(prices)}")


if __name__ == "__main__":
    main()