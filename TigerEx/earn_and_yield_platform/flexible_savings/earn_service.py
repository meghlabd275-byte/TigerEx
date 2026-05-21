"""
TigerEx Earn Products
Flexible savings and locked staking
"""

from typing import Dict, List, Optional
from dataclasses import dataclass
from datetime import datetime, timedelta
import asyncio


# ============================================================================
# Earn Product Types
# ============================================================================

@dataclass
class EarnProduct:
    product_id: str
    product_type: str  # flexible, locked, dual
    currency: str
    apy: float  # Annual percentage yield
    min_deposit: float
    max_deposit: Optional[float]
    lock_period_days: Optional[int]
    early_withdrawal_penalty: float


@dataclass
class EarnPosition:
    position_id: str
    user_id: str
    product_id: str
    currency: str
    deposit_amount: float
    accrued_interest: float
    created_at: datetime
    status: str  # active, claimed, liquidated


# ============================================================================
# Flexible Savings
# ============================================================================

class FlexibleSavings:
    """Daily accrual flexible savings"""
    
    # APY by currency
    RATES = {
        'USDT': 0.12,      # 12% APY
        'USDC': 0.10,      # 10% APY
        'BTC': 0.04,        # 4% APY
        'ETH': 0.06,        # 6% APY
        'BNB': 0.08,        # 8% APY
    }
    
    def __init__(self, db):
        self.db = db
    
    async def subscribe(self, user_id: str, currency: str, amount: float) -> EarnPosition:
        if currency not in self.RATES:
            raise ValueError(f"Unsupported currency: {currency}")
        
        if amount < 10:  # Min deposit
            raise ValueError("Minimum deposit is 10")
        
        # Deduct from wallet
        await self.db.execute(
            "UPDATE wallets SET balance = balance - ? WHERE user_id = ? AND currency = ?",
            (amount, user_id, currency)
        )
        
        # Create position
        position_id = f"FLEX_{currency}_{datetime.now().timestamp()}"
        position = EarnPosition(
            position_id=position_id,
            user_id=user_id,
            product_id=f"flexible_{currency}",
            currency=currency,
            deposit_amount=amount,
            accrued_interest=0,
            created_at=datetime.now(),
            status='active'
        )
        
        # Save position
        await self.db.execute(
            "INSERT INTO earn_positions VALUES (?)",
            (position,)
        )
        
        return position
    
    async def redeem(self, user_id: str, product_id: str) -> float:
        # Get position
        position = await self.get_position(user_id, product_id)
        
        if not position:
            raise ValueError("Position not found")
        
        # Calculate final interest
        days = (datetime.now() - position.created_at).days
        apy = self.RATES.get(position.currency, 0)
        daily_rate = apy / 365
        interest = position.deposit_amount * daily_rate * days
        
        total = position.deposit_amount + interest
        
        # Credit to wallet
        await self.db.execute(
            "UPDATE wallets SET balance = balance + ? WHERE user_id = ?",
            (total, user_id)
        )
        
        # Update position status
        await self.db.execute(
            "UPDATE earn_positions SET status = 'claimed' WHERE position_id = ?",
            (position.position_id,)
        )
        
        return total
    
    async def claim_daily(self, user_id: str) -> float:
        """Claim accumulated daily interest"""
        positions = await self.get_positions(user_id)
        
        total_claimed = 0
        now = datetime.now()
        
        for pos in positions:
            # Calculate daily interest
            apy = self.RATES.get(pos.currency, 0)
            daily_rate = apy / 365
            daily_interest = pos.deposit_amount * daily_rate
            
            # Update accrued
            pos.accrued_interest += daily_interest
            total_claimed += daily_interest
            
            # Credit interest
            await self.db.execute(
                "UPDATE wallets SET balance = balance + ? WHERE user_id = ? AND currency = ?",
                (daily_interest, user_id, pos.currency)
            )
        
        return total_claimed
    
    async def get_positions(self, user_id: str) -> List[EarnPosition]:
        # Query from DB
        return []
    
    async def get_position(self, user_id: str, product_id: str) -> Optional[EarnPosition]:
        return None
    

# ============================================================================
# Locked Staking
# ============================================================================

class LockedStaking:
    """Time-locked staking with higher rates"""
    
    PRODUCTS = {
        'BTC_30': {'currency': 'BTC', 'apy': 0.08, 'days': 30},
        'BTC_60': {'currency': 'BTC', 'apy': 0.10, 'days': 60},
        'BTC_90': {'currency': 'BTC', 'apy': 0.12, 'days': 90},
        'ETH_30': {'currency': 'ETH', 'apy': 0.10, 'days': 30},
        'ETH_60': {'currency': 'ETH', 'apy': 0.12, 'days': 60},
        'ETH_90': {'currency': 'ETH', 'apy': 0.15, 'days': 90},
        'BNB_30': {'currency': 'BNB', 'apy': 0.12, 'days': 30},
    }
    
    EARLY_WITHDRAWAL_PENALTY = 0.10  # 10% of interest
    
    def __init__(self, db):
        self.db = db
    
    async def stake(self, user_id: str, product_id: str, amount: float) -> EarnPosition:
        product = self.PRODUCTS.get(product_id)
        if not product:
            raise ValueError(f"Unknown product: {product_id}")
        
        # Deduct from wallet
        await self.db.execute(
            "UPDATE wallets SET balance = balance - ? WHERE user_id = ? AND currency = ?",
            (amount, user_id, product['currency'])
        )
        
        # Create locked position
        position_id = f"LOCK_{product_id}_{datetime.now().timestamp()}"
        position = EarnPosition(
            position_id=position_id,
            user_id=user_id,
            product_id=product_id,
            currency=product['currency'],
            deposit_amount=amount,
            accrued_interest=0,
            created_at=datetime.now(),
            status='active'
        )
        
        await self.db.execute("INSERT INTO earn_positions VALUES (?)", (position,))
        
        return position
    
    async def redeem(self, user_id: str, product_id: str) -> float:
        position = await self.get_position(user_id, product_id)
        
        if not position:
            raise ValueError("Position not found")
        
        # Check lock period
        product = self.PRODUCTS[product_id]
        days_locked = product['days']
        days_elapsed = (datetime.now() - position.created_at).days
        
        if days_elapsed < days_locked:
            raise ValueError(f"Locked for {days_locked - days_elapsed} more days")
        
        # Calculate interest at full APY
        apy = product['apy']
        days = days_elapsed
        interest = position.deposit_amount * (apy / 365) * days
        
        total = position.deposit_amount + interest
        
        # Credit
        await self.db.execute(
            "UPDATE wallets SET balance = balance + ? WHERE user_id = ?",
            (total, user_id)
        )
        
        return total
    
    async def early_withdraw(self, user_id: str, product_id: str) -> float:
        """Early withdrawal with penalty"""
        position = await self.get_position(user_id, product_id)
        
        if not position:
            raise ValueError("Position not found")
        
        product = self.PRODUCTS[product_id]
        
        # Calculate prorated interest
        days_elapsed = min(
            (datetime.now() - position.created_at).days,
            product['days']
        )
        apy = product['apy']
        interest = position.deposit_amount * (apy / 365) * days_elapsed
        
        # Apply penalty
        penalty = interest * self.EARLY_WITHDRAWAL_PENALTY
        final_interest = interest - penalty
        
        total = position.deposit_amount + final_interest
        
        await self.db.execute(
            "UPDATE wallets SET balance = balance + ? WHERE user_id = ?",
            (total, user_id)
        )
        
        return total
    
    async def get_positions(self, user_id: str) -> List[EarnPosition]:
        return []
    
    async def get_position(self, user_id: str, product_id: str) -> Optional[EarnPosition]:
        return None


# ============================================================================
# Dual Investment (DSS - Dual Investment)
// ============================================================================

class DualInvestment:
    """Dual investment - sell high, buy low"""
    
    STRIKE_RATES = {
        'BTC': {'atm': 0.95, 'otm_above': 1.05, 'otm_below': 0.90},
        'ETH': {'atm': 0.95, 'otm_above': 1.05, 'otm_below': 0.90},
    }
    
    def __init__(self, db):
        self.db = db
    
    async def subscribe(
        self,
        user_id: str,
        currency: str,
        settle_currency: str,
        amount: float,
        strike_price: float,
        duration_days: int,
        option_type: 'call' | 'put'
    ) -> str:
        """Subscribe to dual investment"""
        
        product_id = f"DUAL_{currency}_{strike_price}_{duration_days}"
        
        # Store subscription
        await self.db.execute(
            "INSERT INTO dual_positions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (product_id, user_id, currency, settle_currency, amount, strike_price, 
             duration_days, option_type, 'active')
        )
        
        return product_id
    
    async def settle(self, product_id: str, current_price: float) -> dict:
        """Settle at expiration"""
        
        sub = await self.get_subscription(product_id)
        
        # Determine settlement
        if sub['option_type'] == 'call':
            # Sell high: get settle currency if price > strike
            if current_price >= sub['strike_price']:
                settle_amount = sub['amount'] * sub['strike_price']
                outcome = 'settled'
                settlement_currency = sub['settle_currency']
            else:
                # Keep original
                settle_amount = sub['amount']
                outcome = 'expired'
                settlement_currency = sub['currency']
        else:
            # Buy low: get settle currency if price < strike
            if current_price <= sub['strike_price']:
                settle_amount = sub['amount'] / sub['strike_price']
                outcome = 'settled'
                settlement_currency = sub['settle_currency']
            else:
                keep_settle_amount = sub['amount'] / sub['strike_price']
                settle_amount = sub['amount']
                outcome = 'expired'
                settlement_currency = sub['currency']
        
        return {
            'settlement_amount': settle_amount,
            'settlement_currency': settlement_currency,
            'outcome': outcome
        }


# ============================================================================
# Earn Product Manager
# ============================================================================

class EarnManager:
    def __init__(self, db):
        self.flexible = FlexibleSavings(db)
        self.locked = LockedStaking(db)
        self.dual = DualInvestment(db)
    
    async def get_products(self) -> List[EarnProduct]:
        products = []
        
        # Flexible
        for currency, apy in FlexibleSavings.RATES.items():
            products.append(EarnProduct(
                product_id=f"flexible_{currency}",
                product_type='flexible',
                currency=currency,
                apy=apy,
                min_deposit=10,
                max_deposit=None,
                lock_period_days=None,
                early_withdrawal_penalty=0
            ))
        
        # Locked
        for product_id, config in LockedStaking.PRODUCTS.items():
            products.append(EarnProduct(
                product_id=product_id,
                product_type='locked',
                currency=config['currency'],
                apy=config['apy'],
                min_deposit=10,
                max_deposit=None,
                lock_period_days=config['days'],
                early_withdrawal_penalty=0.10
            ))
        
        return products
    
    async def get_user_earnings(self, user_id: str) -> dict:
        flex_positions = await self.flexible.get_positions(user_id)
        locked_positions = await self.locked.get_positions(user_id)
        
        total_apy_by_currency = {}
        
        for pos in flex_positions:
            total_apy_by_currency[pos.currency] = (
                total_apy_by_currency.get(pos.currency, 0) + pos.deposit_amount
            )
        
        return {
            'flexible': flex_positions,
            'locked': locked_positions,
            'total': total_apy_by_currency
        }


# Usage
if __name__ == '__main__':
    # Demo
    print("TigerEx Earn Products")
    
    print("\nFlexible Savings APY:")
    for cur, apy in FlexibleSavings.RATES.items():
        print(f"  {cur}: {apy*100:.1f}%")
    
    print("\nLocked Staking:")
    for pid, cfg in LockedStaking.PRODUCTS.items():
        print(f"  {pid}: {cfg['apy']*100:.1f}% for {cfg['days']} days")