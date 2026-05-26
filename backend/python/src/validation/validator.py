#!/usr/bin/env python3
"""Validation Module"""

from decimal import Decimal

class Validator:
    @staticmethod
    def validate_order(order):
        errors = []
        if not order.get('symbol'):
            errors.append("Missing symbol")
        if not order.get('price') or order['price'] <= 0:
            errors.append("Invalid price")
        if not order.get('quantity') or order['quantity'] <= 0:
            errors.append("Invalid quantity")
        return errors
    
    @staticmethod
    def validate_address(addr):
        if not addr or len(addr) < 26:
            return False
        return True
    
    @staticmethod
    def validate_amount(amount, min Bal=0.001):
        try:
            val = Decimal(str(amount))
            if val < min:
                return False
        except:
            return False
        return True

print(Validator.validate_order({"symbol": "BTC", "price": 50000, "quantity": 1}))