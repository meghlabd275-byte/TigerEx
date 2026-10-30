#!/usr/bin/env python3
"""
TigerEx Portfolio Manager - Python
Portfolio optimization and rebalancing
"""

from dataclasses import dataclass
from typing import List, Dict, Optional
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
    """Black-Litterman posterior expected returns.

    Implements the standard formula
        E[R] = [(tau*Sigma)^-1 + P^T Omega^-1 P]^-1
               * [(tau*Sigma)^-1 Pi + P^T Omega^-1 Q]
    with pure-Python matrix algebra, so no numeric library is required.
    """

    def __init__(self, market_cov: List[List[float]], omega: Optional[List[List[float]]] = None,
                 tau: float = 0.05):
        if not market_cov or any(len(row) != len(market_cov) for row in market_cov):
            raise ValueError("market_cov must be a non-empty square matrix")
        self.market_cov = market_cov
        self.omega = omega
        self.tau = tau

    @staticmethod
    def _invert(matrix: List[List[float]]) -> List[List[float]]:
        """Gauss-Jordan inversion. Raises when the matrix is singular."""
        size = len(matrix)
        augmented = [list(row) + [1.0 if i == j else 0.0 for j in range(size)]
                     for i, row in enumerate(matrix)]

        for col in range(size):
            pivot_row = max(range(col, size), key=lambda r: abs(augmented[r][col]))
            if abs(augmented[pivot_row][col]) < 1e-12:
                raise ValueError("matrix is singular and cannot be inverted")
            augmented[col], augmented[pivot_row] = augmented[pivot_row], augmented[col]

            pivot = augmented[col][col]
            augmented[col] = [value / pivot for value in augmented[col]]

            for row in range(size):
                if row == col:
                    continue
                factor = augmented[row][col]
                if factor == 0:
                    continue
                augmented[row] = [value - factor * pivot_value
                                  for value, pivot_value in zip(augmented[row], augmented[col])]

        return [row[size:] for row in augmented]

    @staticmethod
    def _multiply(left: List[List[float]], right: List[List[float]]) -> List[List[float]]:
        size = len(right[0])
        return [[sum(left[i][k] * right[k][j] for k in range(len(right)))
                 for j in range(size)] for i in range(len(left))]

    @staticmethod
    def _matvec(matrix: List[List[float]], vector: List[float]) -> List[float]:
        return [sum(row[j] * vector[j] for j in range(len(vector))) for row in matrix]

    def posterior(self, views: List[List[float]], view_returns: List[float],
                  prior_returns: List[float]) -> List[float]:
        """Return posterior expected returns.

        @param views: P matrix, one row per view.
        @param view_returns: Q vector, expected return per view.
        @param prior_returns: Pi vector, equilibrium (prior) expected returns.
        """
        if not views or len(views) != len(view_returns):
            raise ValueError("each view needs exactly one expected return")
        n_assets = len(self.market_cov)
        if len(prior_returns) != n_assets:
            raise ValueError("prior_returns length must match market_cov")
        if any(len(row) != n_assets for row in views):
            raise ValueError("each view row must have one entry per asset")

        tau_cov = [[self.tau * value for value in row] for row in self.market_cov]
        tau_cov_inv = self._invert(tau_cov)

        omega = self.omega
        if omega is None:
            # Heuristic from He & Litterman: diagonal Omega proportional to
            # tau * P Sigma P^T.
            projected = self._multiply(self._multiply(views, tau_cov),
                                       [[views[i][j] for i in range(len(views))]
                                        for j in range(n_assets)])
            omega = [[projected[i][j] if i == j else 0.0 for j in range(len(views))]
                     for i in range(len(views))]
        omega_inv = self._invert(omega)

        views_t = [[views[i][j] for i in range(len(views))] for j in range(n_assets)]
        views_t_omega_inv = self._multiply(views_t, omega_inv)
        # Build [tau*Sigma]^-1 + P^T Omega^-1 P
        middle = [[0.0] * n_assets for _ in range(n_assets)]
        for i in range(n_assets):
            for j in range(n_assets):
                total = tau_cov_inv[i][j]
                for k in range(len(views)):
                    total += views_t_omega_inv[i][k] * views[k][j]
                middle[i][j] = total

        right = self._matvec(tau_cov_inv, prior_returns)
        scaled_views = self._matvec(views_t_omega_inv, view_returns)
        right = [right[i] + scaled_views[i] for i in range(n_assets)]

        return self._matvec(self._invert(middle), right)



def _load_json(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def main(argv: Optional[List[str]] = None) -> int:
    """usage: portfolio.py <portfolio.json>

    portfolio.json: {"capital": float,
                     "holdings": {"BTC": {"quantity": float, "price": float}},
                     "targets": {"BTC": float},
                     "prices": {"BTC": float}}
    """
    import sys

    argv = list(sys.argv[1:] if argv is None else argv)
    if len(argv) != 1:
        print("usage: portfolio.py <portfolio.json>", file=sys.stderr)
        return 1

    try:
        config = _load_json(argv[0])
        capital = float(config["capital"])
        holdings = config["holdings"]
        targets = config["targets"]
        prices = config["prices"]

        pm = PortfolioManager(capital)
        for symbol, position in holdings.items():
            pm.add_asset(symbol, float(position["quantity"]), float(position["price"]))
        pm.set_target_weights(targets)
        rebalances = pm.rebalance(prices)
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        print(f"cannot compute rebalance: {exc}", file=sys.stderr)
        return 1

    print("Rebalances needed:")
    for item in rebalances:
        print(f"  {item.action.upper()} {item.symbol}: {item.quantity:.4f}")

    stats = pm.get_portfolio_stats()
    print(f"\nPortfolio: {json.dumps(stats, indent=2)}")
    print(f"Diversification: {stats['diversification']:.2%}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())