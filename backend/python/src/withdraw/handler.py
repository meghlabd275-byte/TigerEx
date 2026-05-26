#!/usr/bin/env python3
"""Withdraw Handler"""

from decimal import Decimal
from datetime import datetime
from enum import Enum

class Status(Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"

class WithdrawRequest:
    def __init__(self, user_id, amount, address, network="BTC"):
        self.user_id = user_id
        self.amount = Decimal(str(amount))
        self.address = address
        self.network = network
        self.status = Status.PENDING
        self.created = datetime.now()
        self.tx_hash = None
    
    def to_dict(self):
        return {
            "user_id": self.user_id,
            "amount": str(self.amount),
            "address": self.address,
            "network": self.network,
            "status": self.status.value,
            "tx_hash": self.tx_hash,
        }

class WithdrawHandler:
    def __init__(self, wallet_mgr):
        self.wallet = wallet_mgr
        self.pending = {}
    
    def submit(self, request):
        if request.amount < Decimal("0.001"):
            return {"error": "Amount too small"}
        
        if not self._validate_address(request.address, request.network):
            return {"error": "Invalid address"}
        
        self.pending[request.user_id] = request
        return {"status": "pending", "id": request.user_id}
    
    def _validate_address(self, addr, network):
        if network == "BTC":
            return len(addr) >= 26 and len(addr) <= 35
        return True

print(WithdrawHandler(None))