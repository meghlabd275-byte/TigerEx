"""
TigerEx Analytics Module
Migrated from TypeScript to Python for data analysis and BI.
"""
from dataclasses import dataclass
from typing import List, Dict, Optional
from datetime import datetime
import json


@dataclass
class TradingStats:
    """Trading statistics"""
    total_volume: float
    trade_count: int
    avg_price: float
    high_price: float
    low_price: float
    open_price: float
    close_price: float


@dataclass
class PortfolioSummary:
    """User portfolio summary"""
    user_id: str
    total_usd_value: float
    holdings: Dict[str, float]  # asset -> amount
    pnl_24h: float
    pnl_percent: float


def calculate_pnl(opening: float, closing: float) -> tuple[float, float]:
    """Calculate profit/loss and percentage"""
    pnl = closing - opening
    pct = (pnl / opening) * 100 if opening > 0 else 0
    return pnl, pct


def get_portfolio_value(holdings: Dict[str, float], prices: Dict[str, float]) -> float:
    """Calculate total portfolio value in USD"""
    total = 0.0
    for asset, amount in holdings.items():
        price = prices.get(asset, 0)
        total += amount * price
    return total


def calculate_risk_score(volatility: float, volume: float, leverage: float) -> int:
    """Calculate risk score (1-10)"""
    score = 1
    
    # Volatility factor
    if volatility > 0.5:
        score += 3
    elif volatility > 0.2:
        score += 2
    elif volatility > 0.1:
        score += 1
    
    # Volume factor
    if volume > 1000000:
        score += 3
    elif volume > 100000:
        score += 2
    elif volume > 10000:
        score += 1
    
    # Leverage factor
    if leverage > 10:
        score += 3
    elif leverage > 5:
        score += 2
    elif leverage > 1:
        score += 1
    
    return min(score, 10)


def get_market_summary(prices: List[dict]) -> dict:
    """Get market summary from price data"""
    total_vol = sum(p.get('volume', 0) for p in prices)
    total_mcap = sum(p.get('market_cap', 0) for p in prices)
    
    gains = sum(1 for p in prices if p.get('change_24h', 0) > 0)
    losses = sum(1 for p in prices if p.get('change_24h', 0) < 0)
    
    return {
        'total_volume': total_vol,
        'total_market_cap': total_mcap,
        'gainers': gains,
        'losers': losses,
        'timestamp': datetime.now().isoformat()
    }


def analyze_trading_pair(pair_data: dict) -> TradingStats:
    """Analyze trading pair data"""
    trades = pair_data.get('trades', [])
    
    if not trades:
        return TradingStats(
            total_volume=0,
            trade_count=0,
            avg_price=0,
            high_price=0,
            low_price=0,
            open_price=0,
            close_price=0
        )
    
    prices = [t['price'] for t in trades]
    volumes = [t.get('volume', 0) for t in trades]
    
    return TradingStats(
        total_volume=sum(volumes),
        trade_count=len(trades),
        avg_price=sum(prices) / len(prices),
        high_price=max(prices),
        low_price=min(prices),
        open_price=prices[0],
        close_price=prices[-1]
    )


def generate_report(user_id: str, holdings: Dict[str, float], prices: Dict[str, float]) -> str:
    """Generate portfolio report"""
    portfolio_value = get_portfolio_value(holdings, prices)
    
    report = {
        'user_id': user_id,
        'report_date': datetime.now().isoformat(),
        'holdings': holdings,
        'prices': prices,
        'total_value_usd': portfolio_value,
        'holdings_count': len(holdings)
    }
    
    return json.dumps(report, indent=2)


class AnalyticsEngine:
    """Main analytics engine"""
    
    def __init__(self):
        self.data = {}
    
    def add_trade(self, trade: dict):
        """Add trade to analytics"""
        pair = trade.get('pair', 'unknown')
        if pair not in self.data:
            self.data[pair] = []
        self.data[pair].append(trade)
    
    def get_stats(self, pair: str) -> Optional[TradingStats]:
        """Get stats for a pair"""
        if pair not in self.data:
            return None
        return analyze_trading_pair({'trades': self.data[pair]})


def main():
    """Demo runner"""
    print("TigerEx Analytics Engine initialized")
    
    # Demo holdings
    holdings = {
        'BTC': 1.5,
        'ETH': 15.0,
        'USDT': 5000.0
    }
    
    prices = {
        'BTC': 65000.0,
        'ETH': 3500.0,
        'USDT': 1.0
    }
    
    value = get_portfolio_value(holdings, prices)
    print(f"Portfolio Value: ${value:,.2f}")
    
    # Risk calculation
    risk = calculate_risk_score(volatility=0.15, volume=500000, leverage=3)
    print(f"Risk Score: {risk}/10")


if __name__ == "__main__":
    main()