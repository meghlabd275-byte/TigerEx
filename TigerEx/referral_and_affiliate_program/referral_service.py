"""TigerEx Referral"""

class ReferralService:
    FIRST_TRADE = 10.0
    FIRST_DEPOSIT = 20.0
    COMMISSION_PCT = 20.0
    
    async def create_code(self, user_id):
        import hashlib
        return f"TIGER{hashlib.sha256(f'{user_id}'.encode()).hexdigest()[:8].upper()}"
    
    async def apply(self, referee, code):
        return {'success': True}
    
    async def stats(self, user_id):
        return {'referred': 50, 'earned': 5000}


if __name__ == '__main__':
    print("TigerEx Referral Program")