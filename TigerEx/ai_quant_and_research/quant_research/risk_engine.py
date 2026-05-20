"""
TigerEx Risk Engine
Real-time risk calculations for trading
"""

import numpy as np
from typing import Dict, List, Optional
from dataclasses import dataclass
from enum import Enum
import logging

logger = logging.getLogger(__name__)


class RiskLevel(Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


@dataclass
class Position:
    symbol: str
    quantity: float
    entry_price: float
    side: str  # LONG or SHORT
    leverage: float = 1.0


@dataclass
class RiskMetrics:
    unrealized_pnl: float
    margin_used: float
    available_balance: float
    total_exposure: float
    leverage_used: float
    risk_level: RiskLevel
    liquidation_price: Optional[float] = None


class RiskEngine:
    """Real-time risk engine for position monitoring"""
    
    def __init__(self, config: Dict):
        self.max_leverage = config.get('max_leverage', 125)
        self.max_position_size = config.get('max_position_size', 1_000_000)
        self.liquidation_buffer = config.get('liquidation_buffer', 0.005)  # 0.5%
        self.maintenance_margin_ratio = config.get('maintenance_margin', 0.005)
        
    def calculate_risk(
        self,
        positions: List[Position],
        balance: float,
        current_prices: Dict[str, float]
    ) -> RiskMetrics:
        """Calculate comprehensive risk metrics"""
        
        total_exposure = 0.0
        unrealized_pnl = 0.0
        margin_used = 0.0
        
        for pos in positions:
            current_price = current_prices.get(pos.symbol, pos.entry_price)
            
            if pos.side == 'LONG':
                pnl = (current_price - pos.entry_price) * pos.quantity
            else:
                pnl = (pos.entry_price - current_price) * pos.quantity
            
            unrealized_pnl += pnl
            
            # Calculate margin required
            position_value = current_price * pos.quantity
            margin = position_value / pos.leverage
            margin_used += margin
            
            total_exposure += position_value
        
        available_balance = balance - margin_used + unrealized_pnl
        leverage_used = total_exposure / balance if balance > 0 else 0
        
        # Determine risk level
        risk_level = self._determine_risk_level(
            leverage_used, available_balance, balance
        )
        
        # Calculate liquidation prices
        liquidation_prices = {}
        for pos in positions:
            liq_price = self._calculate_liquidation_price(
                pos, current_prices.get(pos.symbol, pos.entry_price)
            )
            liquidation_prices[pos.symbol] = liq_price
        
        # Get nearest liquidation price
        nearest_liq = min(liquidation_prices.values()) if liquidation_prices else None
        
        return RiskMetrics(
            unrealized_pnl=unrealized_pnl,
            margin_used=margin_used,
            available_balance=available_balance,
            total_exposure=total_exposure,
            leverage_used=leverage_used,
            risk_level=risk_level,
            liquidation_price=nearest_liq
        )
    
    def _determine_risk_level(
        self,
        leverage: float,
        available: float,
        total: float
    ) -> RiskLevel:
        """Determine overall risk level"""
        
        if leverage > 20:
            return RiskLevel.CRITICAL
        elif leverage > 10:
            return RiskLevel.HIGH
        elif leverage > 5 or available / total < 0.1:
            return RiskLevel.MEDIUM
        return RiskLevel.LOW
    
    def _calculate_liquidation_price(
        self,
        position: Position,
        current_price: float
    ) -> float:
        """Calculate liquidation price"""
        
        if position.side == 'LONG':
            # For long: liquidation when price drops below maintenance margin
            liq_price = position.entry_price * (
                1 - (1 / position.leverage) + self.maintenance_margin_ratio
            )
        else:
            # For short: liquidation when price rises
            liq_price = position.entry_price * (
                1 + (1 / position.leverage) - self.maintenance_margin_ratio
            )
        
        return liq_price * (1 + self.liquidation_buffer)
    
    def check_order_risk(
        self,
        order_quantity: float,
        order_price: float,
        current_positions: List[Position],
        balance: float
    ) -> tuple[bool, str]:
        """Pre-trade risk check"""
        
        # Check balance
        order_value = order_quantity * order_price
        if order_value > balance:
            return False, "Insufficient balance"
        
        # Check max position size
        if order_value > self.max_position_size:
            return False, "Exceeds maximum position size"
        
        # Check leverage
        current_exposure = sum(
            p.quantity * current_prices.get(p.symbol, p.entry_price)
            for p in current_positions
            for current_prices in [{}]  # Simplified
        )
        
        new_exposure = current_exposure + order_value
        new_leverage = new_exposure / balance
        
        if new_leverage > self.max_leverage:
            return False, f"Would exceed max leverage ({self.max_leverage}x)"
        
        return True, "OK"


class MarginCalculator:
    """Cross-margin and isolated margin calculations"""
    
    @staticmethod
    def calculate_isolated_margin(
        quantity: float,
        entry_price: float,
        leverage: float
    ) -> float:
        """Calculate isolated margin requirement"""
        return (quantity * entry_price) / leverage
    
    @staticmethod
    def calculate_cross_margin(
        positions: List[Position],
        balance: float,
        prices: Dict[str, float]
    ) -> float:
        """Calculate cross-margin requirement"""
        
        total_margin = 0.0
        
        for pos in positions:
            current_price = prices.get(pos.symbol, pos.entry_price)
            position_value = current_price * pos.quantity
            
            # Initial margin rate based on leverage
            imr = 1.0 / pos.leverage
            
            margin = position_value * imr
            total_margin += margin
        
        return total_margin
    
    @staticmethod
    def calculate_margin_ratio(
        equity: float,
        margin_used: float
    ) -> float:
        """Calculate margin ratio"""
        if margin_used == 0:
            return float('inf')
        return equity / margin_used


class FundingRateCalculator:
    """Calculate funding rates for perpetual contracts"""
    
    def __init__(self):
        self.clamp_rate = 0.00075  # 0.075% max
    
    def calculate_funding_rate(
        self,
        index_price: float,
        mark_price: float,
        next_funding_time: int
    ) -> tuple[float, float]:
        """
        Calculate funding rate
        Returns: (funding_rate, next_funding_timestamp)
        """
        
        # Premium = (Mark Price - Index Price) / Index Price
        premium = (mark_price - index_price) / index_price
        
        # Clamp premium
        clamped_premium = np.clip(premium, -self.clamp_rate, self.clamp_rate)
        
        # Funding rate = clamped premium
        funding_rate = clamped_premium
        
        # Payment = funding_rate * mark_price * position_size
        # Typically paid every 8 hours
        
        return funding_rate, next_funding_time


class LiquidationEngine:
    """Automated liquidation engine"""
    
    def __init__(self, config: Dict):
        self.liquidation_enabled = config.get('enabled', True)
        self.liquidation_fee = config.get('fee', 0.0005)  # 0.05%
    
    def check_liquidation(
        self,
        positions: List[Position],
        balance: float,
        prices: Dict[str, float]
    ) -> List[Dict]:
        """Check which positions should be liquidated"""
        
        liquidations = []
        
        for pos in positions:
            current_price = prices.get(pos.symbol, pos.entry_price)
            
            if pos.side == 'LONG':
                liq_price = pos.entry_price * (1 - 1/pos.leverage + 0.005)
                if current_price <= liq_price:
                    liquidations.append({
                        'position': pos,
                        'liquidation_price': liq_price,
                        'current_price': current_price,
                        'reason': 'Long liquidation'
                    })
            else:
                liq_price = pos.entry_price * (1 + 1/pos.leverage - 0.005)
                if current_price >= liq_price:
                    liquidations.append({
                        'position': pos,
                        'liquidation_price': liq_price,
                        'current_price': current_price,
                        'reason': 'Short liquidation'
                    })
        
        return liquidations


# Usage example
if __name__ == '__main__':
    config = {
        'max_leverage': 125,
        'max_position_size': 1_000_000,
        'liquidation_buffer': 0.005,
        'maintenance_margin': 0.005,
        'enabled': True
    }
    
    engine = RiskEngine(config)
    
    positions = [
        Position('BTCUSDT', 1.0, 50000, 'LONG', 10.0),
    ]
    
    current_prices = {'BTCUSDT': 48000}
    balance = 100000
    
    metrics = engine.calculate_risk(positions, balance, current_prices)
    
    print(f"Risk Level: {metrics.risk_level}")
    print(f"Unrealized PnL: ${metrics.unrealized_pnl:.2f}")
    print(f"Leverage: {metrics.leverage_used:.2f}x")
    print(f"Liquidation Price: ${metrics.liquidation_price:.2f}")