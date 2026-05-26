#!/usr/bin/env python3
"""
TigerEx - Multi-Currency Payment Processor
Enterprise Integration Module

Handles:
- Bank transfers (SWIFT, SEPA, FPS)
- Card payments (Visa, Mastercard)
- Crypto settlements
- Fiat on/off ramps
- P2P payments

WARNING: Development code. Requires PCI-DSS compliance for card handling.
"""

import uuid
import hmac
import hashlib
import json
import time
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Tuple
from enum import Enum


# ============================================================================
# PAYMENT TYPES
# ============================================================================

class PaymentMethod(Enum):
    BANK_TRANSFER = "bank_transfer"
    CARD = "card"
    CRYPTO = "crypto"
    P2P = "p2p"
    eWALLET = "ewallet"


class PaymentStatus(Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    REFUNDED = "refunded"
    CANCELLED = "cancelled"


class Currency(Enum):
    USD = "USD"
    EUR = "EUR"
    GBP = "GBP"
    JPY = "JPY"
    CNY = "CNY"


# ============================================================================
# PAYMENT ENTITIES
# ============================================================================

@dataclass
class BankAccount:
    """Bank account details"""
    account_id: str
    account_number: str  # IBAN or local account
    routing_number: str  # SWIFT/ABA
    bank_name: str
    account_holder: str
    country: str
    currency: str
    is_verified: bool = False


@dataclass
class Card:
    """Payment card (never store full number)"""
    card_id: str
    last_4: str
    brand: str  # visa, mastercard
    type: str  # debit, credit
    expiry_month: int
    expiry_year: int
    is_verified: bool = False


@dataclass
class Payment:
    """Payment transaction"""
    payment_id: str
    user_id: str
    amount: float
    currency: str
    method: PaymentMethod
    status: PaymentStatus
    reference: str
    description: str
    created_at: int
    completed_at: Optional[int] = None
    failure_reason: Optional[str] = None


# ============================================================================
# PAYMENT GATEWAY
# ============================================================================

class PaymentGateway:
    """Unified payment processor"""
    
    def __init__(self):
        self.payments: Dict[str, Payment] = {}
        self.bank_accounts: Dict[str, BankAccount] = {}
        self.cards: Dict[str, Card] = {}
        self.pending_payments: Dict[str, Payment] = {}
        
        # Fee structure
        self.fees = {
            ("bank_transfer", "USD"): 25.00,
            ("bank_transfer", "EUR"): 20.00,
            ("card", "USD"): 2.9 + 0.30,
            ("card", "EUR"): 2.5 + 0.25,
            ("crypto", "any"): 1.00,
            ("p2p", "any"): 0,
        }
    
    # ---------------------------------------------------------------------------
    # BANK TRANSFERS
    # ---------------------------------------------------------------------------
    
    def initiate_bank_transfer(
        self,
        user_id: str,
        amount: float,
        currency: str,
        from_account: str,
        to_account: BankAccount,
        reference: str
    ) -> Tuple[Payment, Dict]:
        """Initiate international bank transfer"""
        
        # Validate accounts
        if from_account not in self.bank_accounts:
            return None, {"error": "Invalid source account"}
        
        # Calculate fee
        fee = self.get_fee("bank_transfer", currency)
        net_amount = amount - fee
        
        if net_amount <= 0:
            return None, {"error": "Amount too small"}
        
        # Create payment record
        payment = Payment(
            payment_id=str(uuid.uuid4()),
            user_id=user_id,
            amount=amount,
            currency=currency,
            method=PaymentMethod.BANK_TRANSFER,
            status=PaymentStatus.PENDING,
            reference=reference,
            description=f"Transfer to {to_account.account_holder}",
            created_at=int(time.time())
        )
        
        self.payments[payment.payment_id] = payment
        
        # Return payment and transfer details
        transfer_details = {
            "id": payment.payment_id,
            "amount": amount,
            "fee": fee,
            "net_amount": net_amount,
            "recipient": {
                "name": to_account.account_holder,
                "bank": to_account.bank_name,
                "account": to_account.account_number,
                "routing": to_account.routing_number,
                "country": to_account.country,
            },
            "currency": currency,
            "reference": reference,
        }
        
        return payment, transfer_details
    
    def process_swift_transfer(self, payment_id: str, auth: Dict) -> bool:
        """Process SWIFT transfer"""
        payment = self.payments.get(payment_id)
        if not payment:
            return False
        
        # In production: integrate with SWIFT gateway
        # Validate with bank API, etc.
        
        payment.status = PaymentStatus.COMPLETED
        payment.completed_at = int(time.time())
        
        return True
    
    # ---------------------------------------------------------------------------
    # CARD PAYMENTS
    # ---------------------------------------------------------------------------
    
    def initiate_card_payment(
        self,
        user_id: str,
        amount: float,
        card_last_4: str,
        currency: str,
        reference: str
    ) -> Tuple[Payment, Dict]:
        """Initiate card charge"""
        
        # Find card
        card = None
        for c in self.cards.values():
            if c.last_4 == card_last_4:
                card = c
                break
        
        if not card:
            return None, {"error": "Card not found"}
        
        # Calculate fee
        percent_fee, fixed_fee = self.fees.get(("card", currency), (2.9, 0.30))
        fee = amount * (percent_fee / 100) + fixed_fee
        net_amount = amount - fee
        
        # Create payment
        payment = Payment(
            payment_id=str(uuid.uuid4()),
            user_id=user_id,
            amount=amount,
            currency=currency,
            method=PaymentMethod.CARD,
            status=PaymentStatus.PENDING,
            reference=reference,
            description=f"Card ****{card_last_4}",
            created_at=int(time.time())
        )
        
        self.payments[payment.payment_id] = payment
        
        # Payment intent for 3D Secure
        intent = {
            "id": payment.payment_id,
            "amount": int(amount * 100),  # cents/minor units
            "currency": currency,
            "status": "requires_action",
        }
        
        return payment, intent
    
    def confirm_card_payment(self, payment_id: str, auth_code: str) -> bool:
        """Confirm card payment with authentication"""
        payment = self.payments.get(payment_id)
        if not payment or payment.method != PaymentMethod.CARD:
            return False
        
        # In production: verify 3D Secure
        payment.status = PaymentStatus.COMPLETED
        payment.completed_at = int(time.time())
        
        return True
    
    # ---------------------------------------------------------------------------
    # CRYPTO SETTLEMENTS
    # ---------------------------------------------------------------------------
    
    def initiate_crypto_settlement(
        self,
        user_id: str,
        amount: float,
        from_currency: str,
        to_currency: str,
        reference: str
    ) -> Tuple[Payment, Dict]:
        """Convert and settle in crypto"""
        
        fee = self.fees.get(("crypto", "any"), 1.00)
        net_amount = amount - fee
        
        if net_amount <= 0:
            return None, {"error": "Amount too small"}
        
        # Get conversion rate (would fetch from oracle)
        rate = self.get_conversion_rate(from_currency, to_currency)
        converted = net_amount * rate
        
        payment = Payment(
            payment_id=str(uuid.uuid4()),
            user_id=user_id,
            amount=amount,
            currency=from_currency,
            method=PaymentMethod.CRYPTO,
            status=PaymentStatus.PENDING,
            reference=reference,
            description=f"Convert {from_currency} to {to_currency}",
            created_at=int(time.time())
        )
        
        self.payments[payment.payment_id] = payment
        
        settlement = {
            "id": payment.payment_id,
            "from_amount": amount,
            "from_currency": from_currency,
            "to_amount": converted,
            "to_currency": to_currency,
            "rate": rate,
            "fee": fee,
        }
        
        return payment, settlement
    
    def confirm_crypto_settlement(self, payment_id: str, tx_hash: str) -> bool:
        """Confirm crypto settlement"""
        payment = self.payments.get(payment_id)
        if not payment or payment.method != PaymentMethod.CRYPTO:
            return False
        
        payment.status = PaymentStatus.COMPLETED
        payment.completed_at = int(time.time())
        
        return True
    
    # ---------------------------------------------------------------------------
    # P2P PAYMENTS  
    # ---------------------------------------------------------------------------
    
    def create_p2p_offer(
        self,
        user_id: str,
        amount: float,
        currency: str,
        payment_methods: List[PaymentMethod],
        rate: float  # Markup from market
    ) -> Dict:
        """Create P2P trading offer"""
        
        offer = {
            "offer_id": str(uuid.uuid4()),
            "user_id": user_id,
            "amount": amount,
            "currency": currency,
            "methods": [m.value for m in payment_methods],
            "rate": rate,
            "status": "active",
            "created_at": int(time.time()),
        }
        
        return offer
    
    def match_p2p_order(
        self,
        buyer_id: str,
        seller_id: str,
        amount: float,
        currency: str,
        payment_method: PaymentMethod
    ) -> Tuple[Payment, Payment]:
        """Match P2P buyer/seller"""
        
        # Buyer payment
        buyer.payment = Payment(
            payment_id=str(uuid.uuid4()),
            user_id=buyer_id,
            amount=amount,
            currency=currency,
            method=payment_method,
            status=PaymentStatus.PENDING,
            reference=f"P2P-{seller_id}",
            description="P2P purchase",
            created_at=int(time.time())
        )
        
        # Seller payment
        seller.payment = Payment(
            payment_id=str(uuid.uuid4()),
            user_id=seller_id,
            amount=amount,
            currency=currency,
            method=PaymentMethod.CRYPTO,
            status=PaymentStatus.PENDING,
            reference=f"P2P-{buyer_id}",
            description="P2P sale",
            created_at=int(time.time())
        )
        
        # P2P is fee-free
        return buyer.payment, seller.payment
    
    # ---------------------------------------------------------------------------
    # FIAT ON/OFF RAMP
    # ---------------------------------------------------------------------------
    
    def create_onramp_quote(
        self,
        user_id: str,
        amount: float,
        from_currency: str,
        to_currency: str,
        provider: str = "moonpay"
    ) -> Dict:
        """Create fiat on-ramp quote"""
        
        conversion_rate = self.get_conversion_rate(from_currency, to_currency)
        # Provider markup 3-5%
        provider_markup = conversion_rate * 1.035
        crypto_amount = amount / provider_markup
        
        quote = {
            "quote_id": str(uuid.uuid4()),
            "user_id": user_id,
            "fiat_amount": amount,
            "fiat_currency": from_currency,
            "crypto_amount": crypto_amount,
            "crypto_currency": to_currency,
            "rate": provider_markup,
            "provider": provider,
            "expires_at": int(time.time()) + 600,  # 10 minutes
        }
        
        return quote
    
    def execute_onramp(
        self,
        user_id: str,
        quote_id: str,
        payment_id: str
    ) -> Dict:
        """Execute on-ramp and deliver crypto"""
        # Verify payment received, release crypto
        # Integrates with Moonpay/Koinal/etc
        
        return {
            "status": "completed",
            "crypto_amount": "0.00000000",  # would be calculated
            "tx_hash": str(uuid.uuid4()),
        }
    
    # ---------------------------------------------------------------------------
    # UTILITIES
    # ---------------------------------------------------------------------------
    
    def get_fee(self, method: str, currency: str) -> float:
        """Get fee for payment method"""
        return self.fees.get((method, currency), 10.00)
    
    def get_conversion_rate(self, from_curr: str, to_curr: str) -> float:
        """Get conversion rate (would fetch from oracle)"""
        # Simplified - production would use price feeds
        rates = {
            ("USD", "BTC"): 0.000025,
            ("USD", "ETH"): 0.0005,
            ("EUR", "BTC"): 0.000024,
            ("EUR", "ETH"): 0.00048,
            ("GBP", "BTC"): 0.000028,
            ("GBP", "ETH"): 0.00055,
        }
        
        if from_curr == to_curr:
            return 1.0
        
        return rates.get((from_curr, to_curr), 1.0)
    
    def get_payment(self, payment_id: str) -> Optional[Payment]:
        """Get payment by ID"""
        return self.payments.get(payment_id)
    
    def get_user_payments(self, user_id: str) -> List[Payment]:
        """Get user's payment history"""
        return [p for p in self.payments.values() if p.user_id == user_id]


# ============================================================================
# FRAUD DETECTION
# ============================================================================

class FraudDetector:
    """Payment fraud detection"""
    
    def __init__(self):
        self.risk_rules = []
        self.blocked_ips = set()
        self.blocked_cards = set()
    
    def check_transaction(
        self,
        amount: float,
        currency: str,
        location: str,
        card_last_4: Optional[str],
        ip: str
    ) -> Tuple[bool, str]:
        """Check for fraud indicators"""
        
        if ip in self.blocked_ips:
            return False, "Blocked IP"
        
        if card_last_4 in self.blocked_cards:
            return False, "Blocked card"
        
        # Velocity check - too large
        if amount > 50000:
            return False, "Amount exceeds limit"
        
        # Currency risk
        high_risk = ["KP", "IR", "SY", "CU"]
        if any(c in location.upper() for c in high_risk):
            return False, "High risk location"
        
        return True, "Approved"
    
    def add_block(self, identifier: str, type: str):
        """Block suspicious entity"""
        if type == "ip":
            self.blocked_ips.add(identifier)
        elif type == "card":
            self.blocked_cards.add(identifier)


# ============================================================================
# MAIN
# ============================================================================

def main():
    print("TigerEx Payment Gateway v1.0")
    print("=" * 35)
    
    gateway = PaymentGateway()
    fraud = FraudDetector()
    
    # Test bank transfer
    bank_acc = BankAccount(
        account_id="acc001",
        account_number="DE89370400440532013000",
        routing_number="DEUTDEFF",
        account_holder="John Doe",
        country="DE",
        currency="EUR"
    )
    gateway.bank_accounts["user1"] = bank_acc
    
    payment, details = gateway.initiate_bank_transfer(
        user_id="user1",
        amount=1000,
        currency="EUR",
        from_account="user1",
        to_account=bank_acc,
        reference="INV-2024-001"
    )
    
    print(f"Bank Transfer: {payment.payment_id[:8]}")
    print(f"Fee: ${gateway.get_fee('bank_transfer', 'EUR'):.2f}")
    
    print("\nPayment gateway ready.")


if __name__ == "__main__":
    main()