"""
Research Module for Market Analysis
Migrated from TypeScript to Python for market research and alpha generation.
"""

from dataclasses import dataclass
from typing import List, Dict, Optional
from datetime import datetime, timedelta
import math


@dataclass
class MarketReport:
    """Market research report"""
    symbol: str
    timestamp: int
    sentiment: str  # bullish, bearish, neutral
    recommendation: str  # buy, sell, hold
    target_price: float
    confidence: float
    rationale: str


@dataclass
class TechnicalAnalysis:
    """Technical analysis data"""
    symbol: str
    rsi: float
    macd: float
    trend: str  # up, down, sideways
    support: float
    resistance: float
    pattern: Optional[str]  # chart pattern


def calculate_rsi(prices: List[float], period: int = 14) -> float:
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
    rsi = 100.0 - (100.0 / (1 + rs))
    
    return rsi


def identify_pattern(prices: List[float]) -> Optional[str]:
    """Identify chart patterns"""
    if len(prices) < 30:
        return None
    
    recent = prices[-30:]
    
    # Simple pattern detection
    first_half_avg = sum(recent[:15]) / 15
    second_half_avg = sum(recent[15:]) / 15
    
    # Higher highs and higher lows = uptrend
    highs = [p for i, p in enumerate(recent[5:]) if p > recent[i]]
    lows = [p for i, p in enumerate(recent[:-5]) if p < recent[i]]
    
    if second_half_avg > first_half_avg * 1.05:
        return "ascending_triangle"
    elif second_half_avg < first_half_avg * 0.95:
        return "descending_triangle"
    elif len(highs) > len(lows):
        return "bullish_flag"
    elif len(lows) > len(highs):
        return "bearish_flag"
    
    return "consolidation"


class Analyst:
    """Market analyst"""
    
    def __init__(self):
        self.reports = []
    
    def analyze_symbol(
        self,
        symbol: str,
        prices: List[float],
        volume: float
    ) -> TechnicalAnalysis:
        """Perform technical analysis"""
        
        current = prices[-1] if prices else 0
        
        return TechnicalAnalysis(
            symbol=symbol,
            rsi=calculate_rsi(prices),
            macd=0,  # Would calculate in real impl
            trend=self._identify_trend(prices),
            support=self._find_support(prices),
            resistance=self._find_resistance(prices),
            pattern=identify_pattern(prices)
        )
    
    def _identify_trend(self, prices: List[float]) -> str:
        if len(prices) < 20:
            return "sideways"
        
        recent = prices[-20:]
        first = sum(recent[:10]) / 10
        last = sum(recent[10:]) / 10
        
        if last > first * 1.02:
            return "up"
        elif last < first * 0.98:
            return "down"
        return "sideways"
    
    def _find_support(self, prices: List[float]) -> float:
        if not prices:
            return 0
        return min(prices[-20:])
    
    def _find_resistance(self, prices: List[float]) -> float:
        if not prices:
            return 0
        return max(prices[-20:])
    
    def generate_report(
        self,
        symbol: str,
        prices: List[float],
        volume: float
    ) -> MarketReport:
        """Generate market report"""
        
        analysis = self.analyze_symbol(symbol, prices, volume)
        
        # Determine recommendation
        if analysis.rsi < 30 and analysis.trend == "up":
            sentiment = "bullish"
            recommendation = "buy"
            target = prices[-1] * 1.10
            confidence = 0.75
        elif analysis.rsi > 70 and analysis.trend == "down":
            sentiment = "bearish"
            recommendation = "sell"
            target = prices[-1] * 0.90
            confidence = 0.75
        else:
            sentiment = "neutral"
            recommendation = "hold"
            target = prices[-1] * 1.02
            confidence = 0.50
        
        rationale = f"RSI: {analysis.rsi:.0f}, Pattern: {analysis.pattern or 'none'}"
        
        return MarketReport(
            symbol=symbol,
            timestamp=int(datetime.now().timestamp()),
            sentiment=sentiment,
            recommendation=recommendation,
            target_price=target,
            confidence=confidence,
            rationale=rationale
        )


class AlphaGenerator:
    """Generates alpha signals"""
    
    def __init__(self):
        self.thresholds = {
            "rsi_low": 30,
            "rsi_high": 70,
            "volume_multiplier": 2.0,
        }
    
    def find_opportunities(self, markets: Dict[str, List[float]]) -> List[Dict]:
        """Find trading opportunities"""
        
        opportunities = []
        
        for symbol, prices in markets.items():
            if len(prices) < 20:
                continue
            
            rsi = calculate_rsi(prices)
            
            # Oversold
            if rsi < self.thresholds["rsi_low"]:
                opportunities.append({
                    "symbol": symbol,
                    "signal": "buy",
                    "reason": "oversold",
                    "rsi": rsi,
                    "priority": (30 - rsi) / 30
                })
            
            # Overbought
            elif rsi > self.thresholds["rsi_high"]:
                opportunities.append({
                    "symbol": symbol,
                    "signal": "sell",
                    "reason": "overbought",
                    "rsi": rsi,
                    "priority": (rsi - 70) / 30
                })
        
        # Sort by priority
        opportunities.sort(key=lambda x: x["priority"], reverse=True)
        
        return opportunities[:5]


def main():
    print("Research Module initialized")
    
    # Generate mock data
    prices = [65000 + i * 500 + (i % 10) * 100 for i in range(50)]
    volume = 1000000000
    
    # Analyze
    analyst = Analyst()
    report = analyst.generate_report("BTCUSDT", prices, volume)
    
    print(f"\nReport for {report.symbol}:")
    print(f"  Sentiment: {report.sentiment}")
    print(f"  Recommendation: {report.recommendation}")
    print(f"  Target: ${report.target_price:.0f}")
    print(f"  Confidence: {report.confidence:.0%}")
    print(f"  Rationale: {report.rationale}")
    
    # Find alpha
    markets = {
        "BTCUSDT": prices,
        "ETHUSDT": [3500 + i * 50 + (i % 10) * 10 for i in range(50)],
    }
    
    alpha_gen = AlphaGenerator()
    opps = alpha_gen.find_opportunities(markets)
    
    print(f"\nAlpha opportunities: {len(opps)}")
    for opp in opps:
        print(f"  {opp['symbol']}: {opp['signal']} ({opp['reason']})")


if __name__ == "__main__":
    main()