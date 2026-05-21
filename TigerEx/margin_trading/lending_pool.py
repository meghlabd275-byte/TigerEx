"""Margin Lending"""

class LendingPool:
    SUPPLY_RATE = 0.05
    BORROW_RATE = 0.10
    
    async def supply(self, user, amount): return {'supplied': amount}
    async def borrow(self, user, amount): return {'borrowed': amount}
    async def repay(self, user, amount): return {'repaid': amount}

class MarginAccount:
    async def ratio(self): return 3.0
    async def liquidate(self): return {'liquidated': False}

if __name__ == '__main__':
    print("Margin Ready")