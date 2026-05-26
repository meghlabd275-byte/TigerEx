#!/usr/bin/env python3
"""Billing Service"""

class Invoice:
    def __init__(self, user_id, amount):
        self.user_id = user_id
        self.amount = amount
        self.paid = False

class Billing:
    def __init__(self):
        self.invoices = {}
    
    def create(self, uid, amt):
        inv = Invoice(uid, amt)
        self.invoices[inv.id] = inv
        return inv
    
    def pay(self, inv_id):
        if inv_id in self.invoices:
            self.invoices[inv_id].paid = True

bill = Billing()
inv = bill.create("user1", 100)
bill.pay(inv.id)