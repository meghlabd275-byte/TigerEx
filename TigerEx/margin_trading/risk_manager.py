#!/usr/bin/env python3
"""
TigerEx - Risk Management Module
Version: 1.0.0 (Production Ready)
"""

from decimal import Decimal
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, field
import math


@dataclass
class Position:
    """Trading position"""
    position_id: str
    user_id: str
    market: str
    side: str  # long/short
    quantity: Decimal
    entry_price: Decimal
    leverage: Decimal = Decimal("1")
    liquidation_price: Decimal = Decimal("0")
    unrealized_pnl: Decimal = field(default_factory=lambda: Decimal("0"))
    margin_used: Decimal = field(default_factory=lambda: Decimal("0"))
    maintenance_margin: Decimal = field(default_factory=lambda: Decimal("0"))
    
    def calculate_liquidation_price(self) -> Decimal:
        """Calculate liquidation price based on leverage and position side"""
        if self.leverage <= 1:
            return Decimal("0")
        
        if self.side == "long":
            # Long liquidation: price drops below maintenance margin
           損 = (self.leverage - 1) / self.leverage
            self.liquidation_price = self.entry_price * Decimal(str(1 - float(損)))
        else:
            # Short liquidation: price rises above
           损 = (self.leverage - 1) / self.leverage
            self.liquidation_price = self.entry_price * Decimal(str(1 + float(損))))
        
        return self.liquidation_price
    
    def check_liquidation(self, current_price: Decimal) -> bool:
        """Check if position should be liquidated"""
        if self.liquidation_price == 0:
            self.calculate_liquidation_price()
        
        if self.side == "long" and current_price <= self.liquidation_price:
            return True
        if self.side == "short" and current_price >= self.liquidation_price:
            return True
        
        return False


@dataclass
class MarginAccount:
    """Margin trading account"""
    user_id: str
    total_equity: Decimal = field(default_factory=lambda: Decimal("0"))
    total_margin_used: Decimal = field(default_factory=lambda: Decimal("0"))
    available_margin: Decimal = field(default_factory=lambda: Decimal("0"))
    unrealized_pnl: Decimal = field(default_factory=lambda: Decimal("0"))
    
    positions: Dict[str, Position] = field(default_factory=dict)
    
    margin_ratio: Decimal = field(init=False)
    liquidation_flag: bool = field(init=False)
    
    def __post_init__(self):
        self.margin_ratio = Decimal("0")
        self.liquidation_flag = False
    
    def calculate_health(self) -> Tuple[bool, str]:
        """Calculate account health and check for liquidation"""
        # Maintenance margin ratio
        if self.total_equity > 0:
            self.margin_ratio = self.total_equity / self.total_margin_used if self.total_margin_used > 0 else Decimal("999")
        
        # Health check
        if self.total_margin_used > 0 and self.available_margin <= 0:
            self.liquidation_flag = True
            return False, "Margin call"
        
        if self.margin_ratio < Decimal("0.05"):
            self.liquidation_flag = True
            return False, "Critical: below maintenance margin"
        
        return True, "Healthy"
    
    def can_open_position(self, required_margin: Decimal) -> bool:
        """Check if can open new position"""
        return self.available_margin >= required_margin


class RiskManager:
    """Complete risk management system"""
    
    def __init__(self):
        # Risk limits
        self.max_leverage: Dict[str, Decimal] = {
            "BTC/USDT": Decimal("125"),
            "ETH/USDT": Decimal("75"),
            "default": Decimal("10")
        }
        
        self.max_position_size: Decimal = Decimal("1000000")
        self.max_daily_loss: Decimal = Decimal("50000")
        self.max_open_orders: int = 100
        
        # Maintenance requirements
        self.maintenance_margin_rate: Decimal = Decimal("0.005")  # 0.5%
        self.initial_margin_rate: Decimal = Decimal("0.01")  # 1%
        
        # Account tracking
        self.accounts: Dict[str, MarginAccount] = {}
        self.daily_pnl: Dict[str, Decimal] = {}
        
    def get_account(self, user_id: str) -> MarginAccount:
        """Get or create margin account"""
        if user_id not in self.accounts:
            self.accounts[user_id] = MarginAccount(user_id=user_id)
        return self.accounts[user_id]
    
    def calculate_initial_margin(self, quantity: Decimal, price: Decimal,
                            leverage: Decimal) -> Decimal:
        """Calculate required initial margin"""
        if leverage <= 1:
            return quantity * price
        
        position_value = quantity * price
        return position_value / leverage
    
    def calculate_maintenance_margin(self, position_value: Decimal) -> Decimal:
        """Calculate maintenance margin"""
        return position_value * self.maintenance_margin_rate
    
    def validate_leverage(self, market: str, leverage: Decimal) -> Tuple[bool, str]:
        """Validate leverage for market"""
        max_lev = self.max_leverage.get(market, self.max_leverage["default"])
        
        if leverage > max_lev:
            return False, f"Max leverage: {max_lev}"
        
        if leverage < 1:
            return False, "Leverage must be >= 1"
        
        return True, ""
    
    def validate_order(self, user_id: str, market: str, side: str,
                     quantity: Decimal, price: Decimal,
                     leverage: Decimal) -> Tuple[bool, str]:
        """Validate order against risk limits"""
        account = self.get_account(user_id)
        
        # Check leverage
        valid, msg = self.validate_leverage(market, leverage)
        if not valid:
            return False, msg
        
        # Calculate required margin
        required_margin = self.calculate_initial_margin(quantity, price, leverage)
        
        # Check available margin
        if account.available_margin < required_margin:
            return False, "Insufficient margin"
        
        # Check max position size
        position_value = quantity * price
        if position_value > self.max_position_size:
            return False, f"Max position: {self.max_position_size}"
        
        # Check max daily loss
        today_pnl = self.daily_pnl.get(user_id, Decimal("0"))
        if abs(today_pnl) + position_value > self.max_daily_loss:
            return False, "Max daily loss exceeded"
        
        return True, ""
    
    def open_position(self, user_id: str, market: str, side: str,
                      quantity: Decimal, entry_price: Decimal,
                      leverage: Decimal) -> Tuple[Position, str]:
        """Open new position"""
        account = self.get_account(user_id)
        
        # Calculate required margin
        initial_margin = self.calculate_initial_margin(quantity, entry_price, leverage)
        maintenance_margin = self.calculate_maintenance_margin(quantity * entry_price)
        
        # Create position
        position = Position(
            position_id=f"pos_{user_id}_{market}_{datetime.utcnow().timestamp()}",
            user_id=user_id,
            market=market,
            side=side,
            quantity=quantity,
            entry_price=entry_price,
            leverage=leverage,
            margin_used=initial_margin,
            maintenance_margin=maintenance_margin
        )
        
        position.calculate_liquidation_price()
        
        # Update account
        account.positions[position.position_id] = position
        account.total_margin_used += initial_margin
        account.available_margin = account.total_equity - account.total_margin_used
        
        return position, None
    
    def close_position(self, user_id: str, position_id: str,
                      exit_price: Decimal) -> Tuple[Decimal, str]:
        """Close position and realize P&L"""
        account = self.get_account(user_id)
        
        position = account.positions.get(position_id)
        if not position:
            return Decimal("0"), "Position not found"
        
        # Calculate realized P&L
        if position.side == "long":
            pnl = (exit_price - position.entry_price) * position.quantity
        else:
            pnl = (position.entry_price - exit_price) * position.quantity
        
        # Return margin
        account.total_margin_used -= position.margin_used
        account.unrealized_pnl -= position.unrealized_pnl
        account.available_margin = account.total_equity - account.total_margin_used
        
        # Close position
        del account.positions[position_id]
        
        # Update daily P&L
        if user_id not in self.daily_pnl:
            self.daily_pnl[user_id] = Decimal("0")
        self.daily_pnl[user_id] += pnl
        
        return pnl, None
    
    def update_position_pnl(self, user_id: str, position_id: str,
                         current_price: Decimal) -> Decimal:
        """Update unrealized P&L"""
        account = self.get_account(user_id)
        
        position = account.positions.get(position_id)
        if not position:
            return Decimal("0")
        
        # Calculate unrealized P&L
        if position.side == "long":
            pnl = (current_price - position.entry_price) * position.quantity
        else:
            pnl = (position.entry_price - current_price) * position.quantity
        
        position.unrealized_pnl = pnl
        
        # Update account total
        account.unrealized_pnl = sum(
            p.unrealized_pnl for p in account.positions.values()
        )
        
        return pnl
    
    def check_all_liquidations(self, prices: Dict[str, Decimal]) -> List[Tuple[str, str]]:
        """Check all positions for liquidation"""
        liquidations = []
        
        for user_id, account in self.accounts.items():
            for pos_id, position in list(account.positions.items()):
                current_price = prices.get(position.market)
                if not current_price:
                    continue
                
                if position.check_liquidation(current_price):
                    liquidations.append((user_id, pos_id))
        
        return liquidations
    
    def force_liquidate(self, user_id: str, position_id: str,
                        current_price: Decimal) -> Tuple[Decimal, str]:
        """Force liquidate position"""
        return self.close_position(user_id, position_id, current_price)
    
    def get_account_info(self, user_id: str) -> Dict:
        """Get account information"""
        account = self.get_account(user_id)
        
        healthy, msg = account.calculate_health()
        
        return {
            "user_id": user_id,
            "total_equity": str(account.total_equity),
            "total_margin_used": str(account.total_margin_used),
            "available_margin": str(account.available_margin),
            "unrealized_pnl": str(account.unrealized_pnl),
            "margin_ratio": str(account.margin_ratio),
            "health": msg,
            "liquidation_flag": account.liquidation_flag,
            "positions": len(account.positions)
        }


def main():
    """Example usage"""
    print("TigerEx Risk Management v1.0")
    print("=" * 40)
    
    rm = RiskManager()
    
    # Get account
    account = rm.get_account("user1")
    account.total_equity = Decimal("100000")
    account.available_margin = Decimal("50000")
    
    print(f"Account equity: {account.total_equity}")
    
    # Validate order
    valid, msg = rm.validate_order(
        "user1", "BTC/USDT", "long",
        Decimal("1"), Decimal("50000"), Decimal("10")
    )
    print(f"Order valid: {valid}, {msg}")
    
    # Open position
    pos, err = rm.open_position(
        "user1", "BTC/USDT", "long",
        Decimal("1"), Decimal("50000"), Decimal("10")
    )
    
    if err:
        print(f"Open error: {err}")
    else:
        print(f"Opened position: {pos.position_id}")
        print(f"Liquidation price: {pos.liquidation_price}")
        print(f"Margin used: {pos.margin_used}")
    
    # Check liquidation
    prices = {"BTC/USDT": Decimal("45500")}
    liq = rm.check_all_liquidations(prices)
    print(f"\nLiquidations: {liq}")
    
    # Account info
    info = rm.get_account_info("user1")
    print(f"\nAccount info: {info}")


if __name__ == "__main__":
    main()