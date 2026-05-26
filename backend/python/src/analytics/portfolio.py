#!/usr/bin/env python3
"""
TigerEx Portfolio Manager - Python
Portfolio optimization and rebalancing
"""

from dataclasses import dataclass
from typing import List, Dict
import json
import math

@dataclass
class PortfolioAsset:
    symbol: str
    quantity: float
    value: float
    weight: float
    target_weight: float

@dataclass
class Rebalance:
    symbol: str
    action: str  # buy, sell, hold
    quantity: float
    price: float
    value: float

class PortfolioManager:
    def __init__(self, initial_capital: float = 1000000):
        self.initial_capital = initial_capital
        self.assets: Dict[str, PortfolioAsset] = {}
        self.history: List[dict] = []
    
    def add_asset(self, symbol: str, quantity: float, price: float):
        value = quantity * price
        asset = PortfolioAsset(
            symbol=symbol,
            quantity=quantity,
            value=value,
            weight=0,  # Calculated
            target_weight=0
        )
        self.assets[symbol] = asset
        self._calc_weights()
    
    def _calc_weights(self):
        total = sum(a.value for a in self.assets.values())
        if total > 0:
            for asset in self.assets.values():
                asset.weight = asset.value / total
    
    def set_target_weights(self, targets: Dict[str, float]):
        total = sum(targets.values())
        if abs(total - 1.0) > 0.01:
            raise ValueError("Weights must sum to 1.0")
        
        for symbol, weight in targets.items():
            if symbol in self.assets:
                self.assets[symbol].target_weight = weight
    
    def rebalance(self, prices: Dict[str, float]) -> List[Rebalance]:
        total = sum(a.value for a in self.assets.values())
        if total == 0:
            total = self.initial_capital
        
        self._calc_weights()
        rebalances = []
        
        for symbol, asset in self.assets.items():
            price = prices.get(symbol, 0)
            target_value = total * asset.target_weight
            diff = target_value - asset.value
            
            if diff > price * 0.01:
                qty = diff / price
                rebalances.append(Rebalance(
                    symbol=symbol,
                    action="buy",
                    quantity=qty,
                    price=price,
                    value=diff
                ))
            elif diff < -price * 0.01:
                qty = abs(diff) / price
                rebalances.append(Rebalance(
                    symbol=symbol,
                    action="sell",
                    quantity=qty,
                    price=price,
                    value=abs(diff)
                ))
        
        return rebalances
    
    def get_diversification_score(self) -> float:
        if not self.assets:
            return 0
        
        weights = [a.weight for a in self.assets.values() if a.weight > 0]
        if not weights:
            return 0
        
        # Herfindahl index
        hi = sum(w**2 for w in weights)
        return 1 - hi  # Higher = more diversified
    
    def get_sharpe_ratio(self, returns: List[float], risk_free: float = 0.05) -> float:
        if not returns:
            return 0
        
        mean_ret = sum(returns) / len(returns)
        excess = mean_ret - risk_free
        
        variance = sum((r - mean_ret)**2 for r in returns) / len(returns)
        std = math.sqrt(variance)
        
        return excess / std if std > 0 else 0
    
    def get_portfolio_stats(self) -> dict:
        total = sum(a.value for a in self.assets.values())
        return {
            'total_value': total,
            'num_assets': len(self.assets),
            'diversification': self.get_diversification_score(),
            'largest_position': max(a.weight for a in self.assets.values()) if self.assets else 0,
        }

class RiskParity:
    def __init__(self, assets: List[str]):
        self.assets = assets
    
    def allocate(self, total: float, volatilities: Dict[str, float]) -> Dict[str, float]:
        inv_var = {s: 1/v**2 for s, v in volatilities.items() if v > 0}
        total_inv_var = sum(inv_var.values())
        
        return {s: total * iv/total_inv_var for s, iv in inv_var.items()}

class BlackLitterman:
    def __init__(self, market_cov, omega=None):
        self.market_cov = market_cov
        self.omega = omega
    
    def posterior(self, views, tau=0.05):
        # Simplified Black-Litterman
        return self.market_cov

def main():
    pm = PortfolioManager(100000)
    pm.add_asset("BTC", 2.0, 50000)
    pm.add_asset("ETH", 20.0, 3000)
    pm.add_asset("SOL", 500, 100)
    
    pm.set_target_weights({"BTC": 0.5, "ETH": 0.3, "SOL": 0.2})
    
    prices = {"BTC": 50000, "ETH": 3000, "SOL": 100}
    rebalances = pm.rebalance(prices)
    
    print("Rebalances needed:")
    for r in rebalances:
        print(f"  {r.action.upper()} {r.symbol}: {r.quantity:.4f}")
    
    stats = pm.get_portfolio_stats()
    print(f"\nPortfolio: {json.dumps(stats, indent=2)}")
    print(f"Diversification: {stats['diversification']:.2%}")

if __name__ == "__main__":
    main()