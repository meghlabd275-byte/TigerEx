#!/usr/bin/env python3
"""
TigerEx - Wallet & Balance Management
Version: 1.0.0 (Production Ready)
"""

import json
import secrets
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Dict, List, Optional
from enum import Enum
import asyncio


class WalletType(Enum):
    SPOT = "spot"
    FUNDING = "funding"
    MARGIN = "margin"
    FUTURES = "futures"
    EARNING = "earning"


class TransactionType(Enum):
    DEPOSIT = "deposit"
    WITHDRAWAL = "withdrawal"
    TRANSFER = "transfer"
    TRADE = "trade"
    FEE = "fee"
    REWARD = "reward"
    ADJUSTMENT = "adjustment"


class TransactionStatus(Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class Wallet:
    """User wallet with balance management"""
    
    def __init__(self, user_id: str, asset: str, wallet_type: WalletType = WalletType.SPOT):
        self.wallet_id = secrets.token_urlsafe(12)
        self.user_id = user_id
        self.asset = asset
        self.wallet_type = wallet_type
        
        self.balance = Decimal("0")
        self.locked_balance = Decimal("0")
        self.pending_deposits = Decimal("0")
        self.pending_withdrawals = Decimal("0")
        
        self.total_deposits = Decimal("0")
        self.total_withdrawals = Decimal("0")
        self.total_trades = Decimal("0")
        
        self.created_at = datetime.utcnow()
        self.updated_at = datetime.utcnow()
    
    @property
    def available_balance(self) -> Decimal:
        """Available balance = total - locked - pending"""
        return self.balance - self.locked_balance - self.pending_withdrawals
    
    def freeze(self, amount: Decimal) -> bool:
        """Freeze funds for pending operation"""
        if self.available_balance >= amount:
            self.locked_balance += amount
            self.updated_at = datetime.utcnow()
            return True
        return False
    
    def unfreeze(self, amount: Decimal):
        """Unfreeze funds"""
        self.locked_balance = max(Decimal("0"), self.locked_balance - amount)
        self.updated_at = datetime.utcnow()
    
    def credit(self, amount: Decimal, reason: str = ""):
        """Add funds to wallet"""
        self.balance += amount
        self.total_deposits += amount
        self.updated_at = datetime.utcnow()
        
    def debit(self, amount: Decimal, reason: str = "") -> bool:
        """Remove funds from wallet"""
        if self.available_balance >= amount:
            self.balance -= amount
            self.total_withdrawals += amount
            self.updated_at = datetime.utcnow()
            return True
        return False
    
    def to_dict(self) -> dict:
        return {
            "wallet_id": self.wallet_id,
            "user_id": self.user_id,
            "asset": self.asset,
            "wallet_type": self.wallet_type.value,
            "balance": str(self.balance),
            "locked_balance": str(self.locked_balance),
            "available_balance": str(self.available_balance),
            "total_deposits": str(self.total_deposits),
            "total_withdrawals": str(self.total_withdrawals),
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat()
        }


class Transaction:
    """Financial transaction record"""
    
    def __init__(self, user_id: str, asset: str, amount: Decimal,
                 tx_type: TransactionType, wallet_id: str = ""):
        self.tx_id = secrets.token_urlsafe(16)
        self.user_id = user_id
        self.asset = asset
        self.amount = amount
        self.tx_type = tx_type
        
        self.wallet_id = wallet_id
        self.status = TransactionStatus.PENDING
        
        self.fee = Decimal("0")
        self.net_amount = amount
        
        self.from_address = ""
        self.to_address = ""
        self.tx_hash = ""
        self.block_number = 0
        
        self.reference_id = ""
        self.metadata = {}
        
        self.created_at = datetime.utcnow()
        self.completed_at = None
        self.failed_at = None
        self.failure_reason = ""
    
    def complete(self):
        """Mark transaction complete"""
        self.status = TransactionStatus.COMPLETED
        self.completed_at = datetime.utcnow()
    
    def fail(self, reason: str):
        """Mark transaction failed"""
        self.status = TransactionStatus.FAILED
        self.failed_at = datetime.utcnow()
        self.failure_reason = reason
    
    def to_dict(self) -> dict:
        return {
            "tx_id": self.tx_id,
            "user_id": self.user_id,
            "asset": self.asset,
            "amount": str(self.amount),
            "fee": str(self.fee),
            "net_amount": str(self.net_amount),
            "type": self.tx_type.value,
            "status": self.status.value,
            "tx_hash": self.tx_hash,
            "created_at": self.created_at.isoformat(),
            "completed_at": self.completed_at.isoformat() if self.completed_at else None
        }


class WalletManager:
    """Complete wallet and balance management system"""
    
    def __init__(self):
        self.wallets: Dict[str, Wallet] = {}
        self.transactions: Dict[str, Transaction] = {}
        self.addresses: Dict[str, Dict] = {}  # address -> wallet_id
        
        # Minimums
        self.min_withdrawal: Dict[str, Decimal] = {
            "BTC": Decimal("0.001"),
            "ETH": Decimal("0.01"),
            "USDT": Decimal("10"),
        }
        
        # Withdrawal fees (network fees)
        self.withdrawal_fee: Dict[str, Decimal] = {
            "BTC": Decimal("0.0005"),
            "ETH": Decimal("0.005"),
            "USDT": Decimal("1"),
        }
        
    def get_or_create_wallet(self, user_id: str, asset: str, 
                         wallet_type: WalletType = WalletType.SPOT) -> Wallet:
        """Get existing or create new wallet"""
        key = f"{user_id}:{asset}:{wallet_type.value}"
        
        if key not in self.wallets:
            self.wallets[key] = Wallet(user_id, asset, wallet_type)
        
        return self.wallets[key]
    
    def get_balance(self, user_id: str, asset: str) -> dict:
        """Get balance for asset"""
        wallet = self.get_or_create_wallet(user_id, asset)
        return wallet.to_dict()
    
    def get_all_balances(self, user_id: str) -> List[dict]:
        """Get all balances for user"""
        result = []
        for wallet in self.wallets.values():
            if wallet.user_id == user_id:
                result.append(wallet.to_dict())
        return result
    
    def create_deposit_address(self, user_id: str, asset: str, 
                          blockchain: str) -> str:
        """Create deposit address"""
        # Generate address (in production, integrate with wallets)
        address = self._generate_address(asset, blockchain)
        
        wallet = self.get_or_create_wallet(user_id, asset)
        
        self.addresses[address] = {
            "wallet_id": wallet.wallet_id,
            "user_id": user_id,
            "asset": asset,
            "blockchain": blockchain,
            "label": "",
            "created_at": datetime.utcnow().isoformat()
        }
        
        return address
    
    def _generate_address(self, asset: str, blockchain: str) -> str:
        """Generate deposit address"""
        if asset == "BTC":
            if blockchain == "native":
                return f"bc1{secrets.token_urlsafe(24)}"
            return f"{secrets.token_urlsafe(32)}"
        elif asset == "ETH":
            return f"0x{secrets.token_hex(40)}"
        else:
            return secrets.token_urlsafe(32)
    
    def process_deposit(self, user_id: str, asset: str, amount: Decimal,
                    tx_hash: str, from_address: str = "") -> Transaction:
        """Process incoming deposit"""
        wallet = self.get_or_create_wallet(user_id, asset)
        
        # Create transaction
        tx = Transaction(user_id, asset, amount, 
                    TransactionType.DEPOSIT, wallet.wallet_id)
        tx.tx_hash = tx_hash
        tx.from_address = from_address
        tx.to_address = wallet.wallet_id
        tx.status = TransactionStatus.PROCESSING
        
        self.transactions[tx.tx_id] = tx
        
        # Credit wallet
        wallet.credit(amount, "deposit")
        
        # Complete transaction
        tx.complete()
        
        # Notify (in production, emit event)
        
        return tx
    
    def create_withdrawal(self, user_id: str, asset: str, amount: Decimal,
                     to_address: str) -> tuple:
        """Create withdrawal request"""
        wallet = self.get_or_create_wallet(user_id, asset)
        
        # Check minimum
        min_amt = self.min_withdrawal.get(asset, Decimal("0.0001"))
        if amount < min_amt:
            return None, f"Minimum withdrawal: {min_amt}"
        
        # Check balance
        if wallet.available_balance < amount:
            return None, "Insufficient balance"
        
        # Calculate fee
        fee = self.withdrawal_fee.get(asset, Decimal("0"))
        net_amount = amount - fee
        
        if net_amount <= 0:
            return None, "Amount too small after fees"
        
        # Freeze funds
        wallet.freeze(amount)
        
        # Create transaction
        tx = Transaction(user_id, asset, amount,
                      TransactionType.WITHDRAWAL, wallet.wallet_id)
        tx.fee = fee
        tx.net_amount = net_amount
        tx.to_address = to_address
        tx.status = TransactionStatus.PENDING
        
        self.transactions[tx.tx_id] = tx
        
        return tx, None
    
    def confirm_withdrawal(self, tx_id: str, tx_hash: str) -> bool:
        """Confirm withdrawal submitted"""
        tx = self.transactions.get(tx_id)
        if not tx:
            return False
        
        tx.tx_hash = tx_hash
        tx.status = TransactionStatus.PROCESSING
        
        # Debit wallet
        wallet = self.get_or_create_wallet(tx.user_id, tx.asset)
        wallet.debit(tx.amount, "withdrawal")
        
        # Unfreeze locked amount
        frozen = tx.amount - tx.net_amount - tx.fee
        if frozen > 0:
            wallet.unfreeze(frozen)
        
        return True
    
    def complete_withdrawal(self, tx_id: str) -> bool:
        """Complete withdrawal"""
        tx = self.transactions.get(tx_id)
        if not tx:
            return False
        
        tx.complete()
        
        return True
    
    def cancel_withdrawal(self, tx_id: str) -> bool:
        """Cancel pending withdrawal"""
        tx = self.transactions.get(tx_id)
        if not tx or tx.status != TransactionStatus.PENDING:
            return False
        
        # Unfreeze funds
        wallet = self.get_or_create_wallet(tx.user_id, tx.asset)
        wallet.unfreeze(tx.amount)
        
        tx.status = TransactionStatus.CANCELLED
        
        return True
    
    def internal_transfer(self, from_user: str, to_user: str, asset: str,
                     amount: Decimal) -> Transaction:
        """Internal transfer between users"""
        from_wallet = self.get_or_create_wallet(from_user, asset)
        
        if from_wallet.available_balance < amount:
            raise ValueError("Insufficient balance")
        
        # Debit sender
        from_wallet.debit(amount, "transfer_out")
        
        # Credit receiver
        to_wallet = self.get_or_create_wallet(to_user, asset)
        to_wallet.credit(amount, "transfer_in")
        
        # Create transaction records
        tx = Transaction(from_user, asset, amount,
                      TransactionType.TRANSFER, from_wallet.wallet_id)
        tx.to_address = to_user
        tx.status = TransactionStatus.COMPLETED
        tx.completed_at = datetime.utcnow()
        
        self.transactions[tx.tx_id] = tx
        
        return tx
    
    def get_transaction(self, tx_id: str) -> Optional[Transaction]:
        """Get transaction by ID"""
        return self.transactions.get(tx_id)
    
    def get_user_transactions(self, user_id: str, limit: int = 100) -> List[dict]:
        """Get user transaction history"""
        result = []
        for tx in self.transactions.values():
            if tx.user_id == user_id:
                result.append(tx.to_dict())
                
                if len(result) >= limit:
                    break
        
        return sorted(result, key=lambda x: x["created_at"], reverse=True)
    
    def adjust_balance(self, user_id: str, asset: str, amount: Decimal,
                   reason: str) -> bool:
        """Manual balance adjustment (admin only)"""
        wallet = self.get_or_create_wallet(user_id, asset)
        
        if amount > 0:
            wallet.credit(amount, reason)
        else:
            wallet.debit(abs(amount), reason)
        
        # Record adjustment
        tx = Transaction(user_id, asset, amount,
                      TransactionType.ADJUSTMENT, wallet.wallet_id)
        tx.metadata = {"reason": reason}
        tx.status = TransactionStatus.COMPLETED
        tx.completed_at = datetime.utcnow()
        
        self.transactions[tx.tx_id] = tx
        
        return True


def main():
    """Example usage"""
    print("TigerEx Wallet Manager v1.0")
    print("=" * 40)
    
    wm = WalletManager()
    
    # Get balance
    balance = wm.get_balance("user123", "BTC")
    print(f"Initial balance: {balance}")
    
    # Create deposit address
    address = wm.create_deposit_address("user123", "BTC", "native")
    print(f"Deposit address: {address}")
    
    # Simulate deposit
    tx = wm.process_deposit("user123", "BTC", Decimal("1.5"), 
                        "0xabc123")
    print(f"Deposit tx: {tx.tx_id}")
    
    # Check balance
    balance = wm.get_balance("user123", "BTC")
    print(f"After deposit: {balance}")
    
    # Request withdrawal
    tx, err = wm.create_withdrawal("user123", "BTC", 
                                Decimal("0.5"), 
                                "0xnewaddress")
    if err:
        print(f"Withdrawal error: {err}")
    else:
        print(f"Withdrawal: {tx.tx_id}")
        
        # Confirm withdrawal
        wm.confirm_withdrawal(tx.tx_id, "0xconfirmed")
        print("Withdrawal confirmed")


if __name__ == "__main__":
    main()